"""Real stdlib IMAP/TLS proof against a disposable loopback synthetic mail server."""
from __future__ import annotations

from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

import migadu_inbox as inbox
from test_migadu_inbox import CREDENTIALS, NOW, REQUEST, message


class TestMigaduTransport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory(prefix="loom-synthetic-mail-tls-")
        cls.addClassCleanup(temporary.cleanup)
        cls.certificate = Path(temporary.name) / "cert.pem"
        cls.key = Path(temporary.name) / "key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-noenc",
                        "-keyout", str(cls.key), "-out", str(cls.certificate), "-days", "1",
                        "-subj", "/CN=imap.migadu.com", "-addext", "subjectAltName=DNS:imap.migadu.com"],
                       check=True, capture_output=True, timeout=15)

    def exercise(self, *, trusted: bool):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        server.settimeout(5)
        port = server.getsockname()[1]
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(str(self.certificate), str(self.key))
        body = message()
        parsed = BytesParser(policy=policy.default).parsebytes(body)
        headers = EmailMessage()
        headers["From"], headers["To"] = parsed["From"], parsed["To"]
        header_bytes = headers.as_bytes()
        verbs: list[str] = []
        failures: list[str] = []

        def serve():
            try:
                with server.accept()[0] as accepted:
                    accepted.settimeout(5)
                    with server_context.wrap_socket(accepted, server_side=True) as connection:
                        with connection.makefile("rwb", buffering=0) as stream:
                            stream.write(b"* OK synthetic IMAP ready\r\n")
                            while True:
                                line = stream.readline(8192)
                                if not line:
                                    break
                                tag, verb, *rest = line.rstrip(b"\r\n").split(b" ", 2)
                                verb = verb.upper()
                                verbs.append(verb.decode("ascii"))
                                arguments = rest[0] if rest else b""
                                suffix = tag + b" OK completed\r\n"
                                if verb == b"CAPABILITY":
                                    stream.write(b"* CAPABILITY IMAP4rev1\r\n" + suffix)
                                elif verb == b"LOGIN":
                                    stream.write(suffix)
                                elif verb == b"EXAMINE":
                                    stream.write(b"* 1 EXISTS\r\n* OK [UIDVALIDITY 7] epoch\r\n* OK [UIDNEXT 2] next\r\n" + tag + b" OK [READ-ONLY] selected\r\n")
                                elif verb == b"UID" and arguments.startswith(b"SEARCH "):
                                    stream.write(b"* SEARCH 1\r\n" + suffix)
                                elif verb == b"UID" and arguments.startswith(b"FETCH ") and b"BODY.PEEK[" in arguments:
                                    data = header_bytes if b"HEADER.FIELDS" in arguments else body
                                    metadata = f'* 1 FETCH (UID 1 INTERNALDATE "20-Oct-2026 20:00:00 +0000" RFC822.SIZE {len(body)} BODY[] {{{len(data)}}}\r\n'.encode()
                                    stream.write(metadata + data + b")\r\n" + suffix)
                                elif verb == b"STATUS":
                                    stream.write(b"* STATUS " + REQUEST.folder.encode() + b" (UIDVALIDITY 7)\r\n" + suffix)
                                elif verb == b"LOGOUT":
                                    stream.write(b"* BYE finished\r\n" + suffix)
                                    break
                                else:
                                    # Record only the verb; a LOGIN line could contain a credential.
                                    failures.append(verb.decode("ascii"))
                                    stream.write(tag + b" BAD forbidden command\r\n")
            except ssl.SSLError:
                if trusted:
                    failures.append("unexpected TLS failure")
            except (OSError, ValueError):
                failures.append("synthetic transport failure")
            finally:
                server.close()

        worker = threading.Thread(target=serve)
        worker.start()
        original_connect = socket.create_connection
        destinations = []

        def loopback(address, *args, **kwargs):
            destinations.append(address)
            return original_connect(("127.0.0.1", port), *args, **kwargs)

        context = ssl.create_default_context(cafile=str(self.certificate) if trusted else None)
        try:
            with patch.object(socket, "create_connection", side_effect=loopback), \
                 patch.object(inbox.ssl, "create_default_context", return_value=context):
                if trusted:
                    result = inbox.read_once(CREDENTIALS, REQUEST, connect=inbox.BoundedImap, clock=lambda: NOW)
                    self.assertEqual(result["status"], "found")
                    self.assertIn("123456", result["messages"][0]["text"])
                else:
                    with self.assertRaises(inbox.InboxError):
                        inbox.read_once(CREDENTIALS, REQUEST, connect=inbox.BoundedImap, clock=lambda: NOW)
        finally:
            worker.join(timeout=6)
            if worker.is_alive():
                server.close()
            self.assertFalse(worker.is_alive(), "Synthetic IMAP worker did not stop")
        self.assertEqual(destinations, [(inbox.HOST, 993)])
        self.assertEqual(failures, [])
        return verbs

    def test_verified_tls_real_imap_read_uses_examine_peek_and_no_mutation_commands(self):
        verbs = self.exercise(trusted=True)
        self.assertIn("CAPABILITY", verbs)
        self.assertEqual([verb for verb in verbs if verb != "CAPABILITY"],
                         ["LOGIN", "EXAMINE", "UID", "UID", "UID", "STATUS", "LOGOUT"])

    def test_untrusted_server_certificate_fails_before_sending_login(self):
        self.assertEqual(self.exercise(trusted=False), [])


if __name__ == "__main__":
    unittest.main()
