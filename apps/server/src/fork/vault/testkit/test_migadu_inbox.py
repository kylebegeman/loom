"""Synthetic message and IMAP acceptance for the operator-only Migadu reader."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
import imaplib
import io
import json
import re
import traceback
import unittest
from unittest.mock import patch

import migadu_inbox as inbox

NOW = datetime(2026, 10, 20, 20, 0, tzinfo=timezone.utc)
RUN = "a1" * 16
OTHER_RUN = "b2" * 16
SENDER = "qa@begam.in"
REQUEST = inbox.Request(RUN, NOW - timedelta(minutes=1), SENDER)
CREDENTIALS = inbox.Credentials(inbox.READER, "synthetic-reader-password")


def message(*, recipient: str = REQUEST.recipient, sender: str = SENDER,
            text: str = "Synthetic verification code: 123456", extra: dict[str, str] | None = None) -> bytes:
    value = EmailMessage()
    value["From"] = sender
    value["To"] = recipient
    value["Date"] = "Tue, 20 Oct 2026 20:00:00 +0000"
    for key, content in (extra or {}).items():
        value[key] = content
    value.set_content(text)
    return value.as_bytes()


def selected_headers(body: bytes, fetch: str) -> bytes:
    fields = re.search(r"HEADER\.FIELDS \(([^)]+)\)", fetch)
    if fields is None:
        raise AssertionError("Expected a HEADER.FIELDS request")
    allowed = fields[1].lower().split()
    parsed = BytesParser(policy=policy.compat32).parsebytes(body, headersonly=True)
    return b"".join(name.encode() + b": " + value.encode("ascii", "surrogateescape").replace(b"\r\n", b"\n").replace(b"\n", b"\r\n") + b"\r\n"
                    for name, value in parsed.raw_items() if name.lower() in allowed) + b"\r\n"


class FixtureClient:
    def __init__(self, bodies: dict[int, bytes] | None = None, *, fallback: bool = False):
        self.bodies = bodies if bodies is not None else {1: message()}
        self.arrivals = {uid: NOW for uid in self.bodies}
        self.next_uid = max(self.bodies, default=0) + 1
        self.validity = 7
        self.status_validity = 7
        self.commands: list[tuple[object, ...]] = []
        self.fallback = fallback
        self.closed = False
        self.body_fetches: list[int] = []
        self.fetch_hook = lambda: None
        self.search_reply: bytes | None = None
        self.reported_uid: int | None = None
        self.reported_size: int | None = None
        self.failed_login = False
        self.failed_fetch = False

    def login(self, username: str, password: str):
        self.commands.append(("LOGIN", username))
        if self.failed_login:
            raise imaplib.IMAP4.error("private-provider-error-canary")
        return "OK", [b"Authenticated"]

    def select(self, folder: str, readonly: bool = False):
        if not readonly:
            raise AssertionError("A writable SELECT is forbidden")
        self.commands.append(("EXAMINE", folder))
        if self.fallback and folder != "INBOX":
            return "NO", [b"No run folder"]
        return "OK", [str(len(self.bodies)).encode()]

    def response(self, name: str):
        self.commands.append(("RESPONSE", name))
        return name, [str(self.validity if name == "UIDVALIDITY" else self.next_uid).encode()]

    def uid(self, command: str, *args: object):
        self.commands.append(("UID", command, *args))
        if command == "SEARCH":
            lower, upper = (int(value) for value in str(args[-1]).split(":"))
            found = b" ".join(str(uid).encode() for uid in self.bodies if lower <= uid <= upper)
            return "OK", [found if self.search_reply is None else self.search_reply]
        if command != "FETCH" or "BODY.PEEK[" not in str(args[-1]):
            raise AssertionError("Only UID SEARCH and BODY.PEEK reads are permitted")
        if self.failed_fetch:
            return "BAD", [b"private-provider-error-canary"]
        uid = int(str(args[0]))
        body = self.bodies[uid]
        header_only = "HEADER.FIELDS" in str(args[-1])
        if header_only:
            body = selected_headers(body, str(args[-1]))
        else:
            self.body_fetches.append(uid)
            self.fetch_hook()
        arrived = self.arrivals[uid]
        stamp = f'{arrived.day:02}-{inbox.MONTHS[arrived.month - 1]}-{arrived.year} {arrived:%H:%M:%S %z}'
        actual_uid = self.reported_uid if self.reported_uid is not None else uid
        size = self.reported_size if self.reported_size is not None else len(self.bodies[uid])
        metadata = f'1 (UID {actual_uid} INTERNALDATE "{stamp}" RFC822.SIZE {size} BODY[] {{{len(body)}}}'.encode()
        return "OK", [(metadata, body), b")"]

    def status(self, folder: str, names: str):
        self.commands.append(("STATUS", folder, names))
        return "OK", [f'{folder} (UIDVALIDITY {self.status_validity})'.encode()]

    def logout(self):
        self.commands.append(("LOGOUT",))
        return "BYE", [b"logged out"]

    def shutdown(self):
        self.closed = True


class CountingStream(io.BytesIO):
    delivered = 0

    def read(self, size=-1):
        value = super().read(size)
        self.delivered += len(value)
        return value

    def readline(self, size=-1):
        value = super().readline(size)
        self.delivered += len(value)
        return value


class FloodSocket:
    def __init__(self, data):
        self.stream = CountingStream(data)

    def settimeout(self, timeout):
        pass

    def recv(self, size):
        return self.stream.read(size)

    def makefile(self, *args, **kwargs):
        return self.stream

    def sendall(self, data):
        pass

    def shutdown(self, *args):
        pass

    def close(self):
        self.stream.close()


class TestMigaduInbox(unittest.TestCase):
    def read(self, client: FixtureClient, *, request: inbox.Request = REQUEST, clock=lambda: NOW):
        return inbox.read_once(CREDENTIALS, request, connect=lambda: client, clock=clock)

    def test_finds_real_mime_message_in_exact_plus_folder_with_read_only_commands(self):
        client = FixtureClient()
        result = self.read(client)
        self.assertEqual(result["status"], "found")
        self.assertEqual(result["recipient"], REQUEST.recipient)
        self.assertEqual(result["folder"], "loom-" + RUN)
        self.assertEqual(result["messages"][0]["text"].strip(), "Synthetic verification code: 123456")
        self.assertIn(("EXAMINE", "loom-" + RUN), client.commands)
        self.assertTrue(result["readOnly"])
        self.assertFalse(result["senderAuthenticated"])
        self.assertFalse(result["canReadLive"])
        self.assertFalse(result["canExecute"])
        self.assertFalse(result["automaticResumption"])
        self.assertFalse(result["automaticVerification"])
        self.assertFalse(result["allowOnceConsumption"])
        self.assertTrue(client.closed)
        self.assertNotIn(CREDENTIALS.password, repr(client.commands))

    def test_rewrite_mailbox_uses_inbox_fallback_but_still_filters_recipient(self):
        client = FixtureClient({1: message(recipient="vault@begam.in"), 2: message()}, fallback=True)
        result = self.read(client)
        self.assertEqual(result["folder"], "INBOX")
        self.assertEqual([entry["uid"] for entry in result["messages"]], [2])
        self.assertEqual(client.body_fetches, [2])
        self.assertEqual([entry[0] for entry in client.commands].count("EXAMINE"), 2)

    def test_other_run_wrong_sender_base_mailbox_and_conflicting_aliases_never_fetch_body(self):
        other = REQUEST.recipient.replace(RUN, OTHER_RUN)
        client = FixtureClient({1: message(recipient=other), 2: message(sender="other@begam.in"),
                                3: message(recipient=inbox.MAILBOX),
                                4: message(recipient=REQUEST.recipient + ", " + other),
                                5: message(recipient=REQUEST.recipient, extra={"X-Original-To": other})})
        result = self.read(client)
        self.assertEqual(result["messages"], [])
        self.assertEqual(client.body_fetches, [])
        self.assertEqual(result["status"], "pending-in-bounded-window")

    def test_server_arrival_time_filters_old_and_future_messages_not_the_date_header(self):
        old_header = BytesParser(policy=policy.default).parsebytes(message())
        old_header.replace_header("Date", "Mon, 20 Oct 2025 20:00:00 +0000")
        client = FixtureClient({1: message(), 2: message(), 3: old_header.as_bytes()})
        client.arrivals[1] = REQUEST.started_at - timedelta(seconds=1)
        client.arrivals[2] = NOW + timedelta(seconds=1)
        result = self.read(client)
        self.assertEqual([entry["uid"] for entry in result["messages"]], [3])
        self.assertEqual(client.body_fetches, [3])

    def test_request_age_and_injected_alias_refuse_before_connect(self):
        for request in (inbox.Request("bad\r\nUID STORE 1 FLAGS ", NOW, SENDER),
                        inbox.Request(RUN, NOW - inbox.WINDOW, SENDER),
                        inbox.Request(RUN, NOW + timedelta(seconds=1), SENDER),
                        inbox.Request(RUN, NOW.replace(tzinfo=None), SENDER),
                        inbox.Request(RUN, NOW, 'qa@begam.in\r\nHEADER')):
            with self.subTest(request=request), patch.object(inbox, "BoundedImap") as connect:
                with self.assertRaises(inbox.InboxError):
                    inbox.read_once(CREDENTIALS, request, connect=connect, clock=lambda: NOW)
                connect.assert_not_called()

    def test_expiry_during_body_fetch_withdraws_all_results(self):
        client = FixtureClient({uid: message() for uid in (1, 2, 3)})
        now = [NOW]
        client.fetch_hook = lambda: now.__setitem__(0, REQUEST.started_at + inbox.WINDOW)
        with self.assertRaisesRegex(inbox.InboxError, "window"):
            self.read(client, clock=lambda: now[0])
        self.assertTrue(client.closed)
        self.assertEqual(client.body_fetches, [3])
        self.assertEqual(len([entry for entry in client.commands if entry[:2] == ("UID", "FETCH")]), 2)

    def test_expiry_during_logout_withdraws_results_before_they_reach_the_caller(self):
        client = FixtureClient()
        now = [NOW]
        original = client.logout

        def delayed_logout():
            now[0] = REQUEST.started_at + inbox.WINDOW
            return original()
        client.logout = delayed_logout
        with self.assertRaisesRegex(inbox.InboxError, "window"):
            self.read(client, clock=lambda: now[0])
        self.assertTrue(client.closed)

    def test_uid_epoch_change_and_wrong_fetch_identity_withdraw_results(self):
        for change in ("epoch", "uid"):
            client = FixtureClient()
            if change == "epoch":
                client.status_validity += 1
            else:
                client.reported_uid = 2
            with self.subTest(change=change), self.assertRaises(inbox.InboxError):
                self.read(client)
            self.assertTrue(client.closed)

    def test_search_is_bounded_to_snapshot_and_rejects_out_of_range_or_duplicate_uids(self):
        client = FixtureClient({uid: message() for uid in range(1, 101)})
        result = self.read(client)
        self.assertIn(("UID", "SEARCH", None, "UID", "37:100"), client.commands)
        self.assertEqual([entry["uid"] for entry in result["messages"]], [100, 99, 98])
        self.assertEqual(result["coverage"], "bounded-latest-64-uids")
        for reply in (b"1 1", b"0", b"2", b"not-a-uid", b" ".join([b"1"] * 65)):
            broken = FixtureClient()
            broken.search_reply = reply
            with self.subTest(reply=reply), self.assertRaises(inbox.InboxError):
                self.read(broken)

    def test_empty_mailbox_does_not_issue_reversed_uid_search(self):
        client = FixtureClient({})
        result = self.read(client)
        self.assertEqual(result["messages"], [])
        self.assertEqual([entry for entry in client.commands if entry[0] == "UID"], [])

    def test_large_matching_message_reports_an_unusable_candidate_before_body_download(self):
        client = FixtureClient()
        client.reported_size = inbox.MAX_MESSAGE_BYTES + 1
        result = self.read(client)
        self.assertEqual(result["status"], "unusable-candidates")
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["candidates"], [{"uid": 1, "status": "unusable", "reason": "message-too-large"}])
        self.assertEqual(client.body_fetches, [])

    def test_oversized_headers_are_skipped_without_withdrawing_another_message(self):
        for old in (True, False):
            client = FixtureClient({1: message(sender="other@begam.in", extra={"Cc": "x" * inbox.MAX_HEADER_BYTES}), 2: message()}, fallback=True)
            if old:
                client.arrivals[1] = NOW - timedelta(days=2)
            with self.subTest(old=old):
                result = self.read(client)
                self.assertEqual(result["status"], "found")
                self.assertEqual([entry["uid"] for entry in result["messages"]], [2])
                self.assertEqual(client.body_fetches, [2])
                self.assertEqual(result["candidates"], [] if old else [{"uid": 1, "status": "unclassified", "reason": "headers-too-large"}])

    def test_body_must_still_match_header_size_and_recipient(self):
        client = FixtureClient()
        original = client.uid

        def changed(command, *args):
            if command == "FETCH" and "HEADER.FIELDS" not in str(args[-1]):
                client.bodies[1] = message(recipient=REQUEST.recipient.replace(RUN, OTHER_RUN))
            return original(command, *args)
        client.uid = changed
        with self.assertRaisesRegex(inbox.InboxError, "changed"):
            self.read(client)

    def test_plain_text_decodes_multipart_without_attachments_or_html_execution(self):
        value = EmailMessage()
        value["From"], value["To"] = SENDER, REQUEST.recipient
        value.set_content("Read this verification code: 654321")
        value.add_alternative('<script>private-canary</script><img src="https://invalid">', subtype="html")
        value.add_attachment(b"attachment-canary", maintype="text", subtype="plain", filename="private.txt")
        client = FixtureClient({1: value.as_bytes()})
        result = self.read(client)
        self.assertEqual(result["messages"][0]["text"].strip(), "Read this verification code: 654321")
        self.assertNotIn("canary", json.dumps(result))

    def test_forwarded_messages_are_not_an_alternate_verification_source(self):
        outer = EmailMessage()
        outer["From"], outer["To"] = SENDER, REQUEST.recipient
        outer.set_content("Outer text")
        inner = EmailMessage()
        inner.set_content("forwarded-secret-canary")
        outer.add_attachment(inner)
        result = self.read(FixtureClient({1: outer.as_bytes()}))
        self.assertNotIn("forwarded-secret-canary", json.dumps(result))

    def test_html_only_message_is_not_rendered_or_followed(self):
        value = EmailMessage()
        value["From"], value["To"] = SENDER, REQUEST.recipient
        value.set_content('<a href="https://invalid/token-canary">Verify</a>', subtype="html")
        result = self.read(FixtureClient({1: value.as_bytes()}))
        self.assertEqual(result["messages"][0]["text"], "")
        self.assertNotIn("token-canary", json.dumps(result))

    def test_unusable_body_is_reported_without_withdrawing_another_uids_text(self):
        prefix = f"From: {SENDER}\nTo: {REQUEST.recipient}\n".encode()
        multipart = prefix + b'Content-Type: multipart/alternative; boundary="b1"\n\n--b1\nContent-Type: text/plain\n\nWelcome\n'
        many = EmailMessage()
        many["From"], many["To"] = SENDER, REQUEST.recipient
        many.make_mixed()
        for _ in range(33):
            child = EmailMessage()
            child.set_content("Welcome")
            many.attach(child)
        bodies = {
            "missing-close-boundary": (multipart, "invalid-mime"),
            "missing-start-boundary": (prefix + b'Content-Type: multipart/mixed; boundary="absent"\n\nWelcome\n', "invalid-mime"),
            "missing-separator": (prefix + b'not a header\nWelcome\n', "invalid-mime"),
            "first-continuation": (b' stray continuation\n' + prefix + b'\nWelcome\n', "invalid-mime"),
            "too-many-parts": (many.as_bytes(), "too-many-mime-parts"),
            "invalid-base64": (prefix + b'Content-Type: text/plain\nContent-Transfer-Encoding: base64\n\n!!!!YQ==\n', "invalid-mime"),
            "unknown-charset": (prefix + b'Content-Type: text/plain; charset=unknown-8bit\n\nWelcome\n', "unsupported-text-encoding"),
            "too-much-text": (message(text="x" * (inbox.MAX_TEXT_BYTES + 1)), "text-too-large"),
        }
        for label, (body, reason) in bodies.items():
            for bad_uid in (1, 2):
                with self.subTest(label=label, bad_uid=bad_uid):
                    good_uid = 3 - bad_uid
                    client = FixtureClient({bad_uid: body, good_uid: message()})
                    result = self.read(client)
                    self.assertEqual(result["status"], "found")
                    self.assertEqual([entry["uid"] for entry in result["messages"]], [good_uid])
                    self.assertIn("123456", result["messages"][0]["text"])
                    self.assertEqual(result["candidates"], [{"uid": bad_uid, "status": "unusable", "reason": reason}])
                    self.assertEqual(client.body_fetches, [2, 1])

    def test_only_unusable_text_does_not_report_pending(self):
        result = self.read(FixtureClient({1: message(text="x" * (inbox.MAX_TEXT_BYTES + 1))}))
        self.assertEqual(result["status"], "unusable-candidates")
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["candidates"][0]["reason"], "text-too-large")

    def test_login_and_read_errors_never_disclose_provider_messages(self):
        for operation in ("login", "fetch"):
            client = FixtureClient()
            client.failed_login = operation == "login"
            client.failed_fetch = operation == "fetch"
            with self.subTest(operation=operation), self.assertRaises(inbox.InboxError) as error:
                self.read(client)
            self.assertNotIn("private-provider-error-canary", str(error.exception))
            self.assertNotIn("private-provider-error-canary", "".join(traceback.format_exception(error.exception)))
            self.assertIsNone(error.exception.__cause__)
            if error.exception.__context__ is not None:
                self.assertTrue(error.exception.__suppress_context__)
            self.assertTrue(client.closed)

    def test_wrong_reader_never_connects_and_password_is_not_in_repr(self):
        with patch.object(inbox, "BoundedImap") as connect:
            with self.assertRaises(inbox.InboxError):
                inbox.read_once(inbox.Credentials(inbox.MAILBOX, "private"), REQUEST, connect=connect, clock=lambda: NOW)
            connect.assert_not_called()
        self.assertNotIn(CREDENTIALS.password, repr(CREDENTIALS))

    def test_password_protocol_injection_refuses_before_connect(self):
        with patch.object(inbox, "BoundedImap") as connect:
            for password in ("secret\r\nUID STORE 1 FLAGS (\\Seen)", "secret\x00", ""):
                with self.subTest(length=len(password)), self.assertRaises(inbox.InboxError):
                    inbox.read_once(inbox.Credentials(inbox.READER, password), REQUEST, connect=connect, clock=lambda: NOW)
            connect.assert_not_called()

    def test_case_variations_cannot_hide_another_runs_recipient(self):
        other = REQUEST.recipient.replace(RUN, OTHER_RUN).upper()
        client = FixtureClient({1: message(recipient=REQUEST.recipient + ", " + other),
                                2: message(recipient=REQUEST.recipient.upper(), sender=SENDER.upper())})
        result = self.read(client)
        self.assertEqual([entry["uid"] for entry in result["messages"]], [2])
        self.assertEqual(client.body_fetches, [2])

    def test_default_live_connection_is_disabled_before_any_authentication(self):
        with patch.object(inbox, "BoundedImap") as connect:
            with self.assertRaisesRegex(inbox.InboxError, "Live Migadu reads are disabled"):
                inbox.read_once(CREDENTIALS, REQUEST, clock=lambda: NOW)
            connect.assert_not_called()

    def test_unsupported_python_refuses_instead_of_silently_mismatching_recipients(self):
        with patch.object(inbox.sys, "version_info", (3, 12)), patch.object(inbox, "BoundedImap") as connect:
            with self.assertRaisesRegex(inbox.InboxError, "Python 3.13"):
                inbox.read_once(CREDENTIALS, REQUEST, connect=connect, clock=lambda: NOW)
            connect.assert_not_called()

    def test_raw_encoded_from_cannot_abort_inbox_fallback(self):
        hostile = (b"From: =?utf-8?q?Prize=0D=0ABcc=3A_x?= <spam@unrelated.example>\r\nTo: "
                   + REQUEST.recipient.encode() + b"\r\n\r\nSpam")
        client = FixtureClient({1: hostile, 2: message()}, fallback=True)
        result = self.read(client)
        self.assertEqual([entry["uid"] for entry in result["messages"]], [2])
        self.assertEqual(client.body_fetches, [2])

    def test_same_second_mail_is_not_lost_to_local_microseconds(self):
        request = inbox.Request(RUN, NOW.replace(microsecond=800000), SENDER)
        client = FixtureClient()
        result = self.read(client, request=request, clock=lambda: NOW + timedelta(seconds=1))
        self.assertEqual(result["status"], "found")
        self.assertEqual(client.body_fetches, [1])

    def test_each_requested_recipient_field_can_reveal_a_conflicting_run(self):
        other = REQUEST.recipient.replace(RUN, OTHER_RUN)
        for name in ("Cc", "Delivered-To", "X-Original-To"):
            with self.subTest(name=name):
                client = FixtureClient({1: message(extra={name: other})})
                self.assertEqual(self.read(client)["messages"], [])
                self.assertEqual(client.body_fetches, [])

    def test_defective_recipient_headers_cannot_hide_a_conflicting_run(self):
        other = REQUEST.recipient.replace(RUN, OTHER_RUN)
        for recipient in (REQUEST.recipient + "; " + other, REQUEST.recipient + ", " + other + "."):
            with self.subTest(recipient=recipient):
                body = f"From: {SENDER}\r\nTo: {recipient}\r\n\r\nUntrusted\r\n".encode()
                client = FixtureClient({1: body})
                self.assertEqual(self.read(client)["messages"], [])
                self.assertEqual(client.body_fetches, [])

    def test_body_metadata_drift_withdraws_the_entire_observation(self):
        for change in ("arrival", "size", "length"):
            client = FixtureClient({1: message(), 2: message()})
            original = client.uid

            def drift(command, *args):
                kind, data = original(command, *args)
                if command == "FETCH" and args[0] == "1" and "HEADER.FIELDS" not in str(args[-1]):
                    metadata, body = data[0]
                    if change == "arrival":
                        metadata = metadata.replace(b"20:00:00", b"19:59:59")
                    elif change == "size":
                        metadata = metadata.replace(f"RFC822.SIZE {len(body)}".encode(), f"RFC822.SIZE {len(body) + 1}".encode())
                    else:
                        body = body[:-10]
                    return kind, [(metadata, body), b")"]
                return kind, data
            client.uid = drift
            with self.subTest(change=change), self.assertRaisesRegex(inbox.InboxError, "changed"):
                self.read(client)
            self.assertEqual(client.body_fetches, [2, 1])

    def test_vanished_uid_does_not_withdraw_another_message(self):
        for phase in ("header", "body"):
            for reply in (("OK", [None]), ("NO", [b"message no longer exists"])):
                client = FixtureClient({1: message(), 2: message()}, fallback=True)
                original = client.uid

                def disappear(command, *args):
                    if command == "FETCH" and args[0] == "1" and (("HEADER.FIELDS" in str(args[-1])) == (phase == "header")):
                        return reply
                    return original(command, *args)
                client.uid = disappear
                with self.subTest(phase=phase, kind=reply[0]):
                    result = self.read(client)
                    self.assertEqual([entry["uid"] for entry in result["messages"]], [2])
                    self.assertEqual(result["candidates"], [{"uid": 1, "status": "unavailable", "reason": "message-unavailable"}])

    def test_only_unavailable_uid_reports_incomplete_instead_of_pending(self):
        client = FixtureClient()
        original = client.uid

        def disappear(command, *args):
            return ("OK", [None]) if command == "FETCH" else original(command, *args)
        client.uid = disappear
        result = self.read(client)
        self.assertEqual(result["status"], "incomplete-in-bounded-window")
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["candidates"], [{"uid": 1, "status": "unavailable", "reason": "message-unavailable"}])

    def test_unknown_multipart_types_are_mixed_but_forwarded_messages_stay_closed(self):
        for subtype in ("signed", "x-future"):
            outer = EmailMessage()
            outer["From"], outer["To"] = SENDER, REQUEST.recipient
            outer.make_mixed()
            outer.set_type("multipart/" + subtype)
            child = EmailMessage()
            child.set_content("Verification: 456789")
            outer.attach(child)
            attachment = EmailMessage()
            attachment.set_type("message/rfc822")
            hidden = EmailMessage()
            hidden.set_content("forwarded-secret-canary")
            attachment.set_payload([hidden])
            outer.attach(attachment)
            with self.subTest(subtype=subtype):
                result = self.read(FixtureClient({1: outer.as_bytes()}))
                self.assertIn("456789", result["messages"][0]["text"])
                self.assertNotIn("forwarded-secret-canary", json.dumps(result))

    def test_aggregate_budget_stops_untagged_line_and_literal_floods(self):
        for literals in (False, True):
            if literals:
                record = b"* 1 FETCH (BODY[] {200000}\r\n" + b"x" * 200000 + b")\r\n"
                flood = record * 50
            else:
                flood = (b"* OK " + b"x" * 1000 + b"\r\n") * 5000
            socket = FloodSocket(b"* OK synthetic ready\r\n" + flood)
            with self.subTest(literals=literals), patch.object(inbox.BoundedImap, "_create_socket", return_value=socket):
                with self.assertRaises(inbox.InboxError):
                    inbox.BoundedImap()
                self.assertLessEqual(socket.stream.delivered, inbox.MAX_TRANSFER_BYTES + imaplib.DEFAULT_BUFFER_SIZE)

    def test_expired_readline_deadline_stops_before_socket_access(self):
        client = object.__new__(inbox.BoundedImap)
        client._budget, client._deadline, client._readbuf = inbox.MAX_TRANSFER_BYTES, 0, []
        client.sock = FloodSocket(b"* OK should not be read\r\n")
        with self.assertRaises(inbox.InboxError):
            client.readline()
        self.assertEqual(client.sock.stream.delivered, 0)

    def test_literal_size_and_expired_transport_budget_refuse_before_reading(self):
        client = object.__new__(inbox.BoundedImap)
        client._budget = inbox.MAX_TRANSFER_BYTES
        client._deadline = 0
        with self.assertRaises(inbox.InboxError):
            client.read(inbox.MAX_MESSAGE_BYTES + 2)
        with self.assertRaises(inbox.InboxError):
            client.read(1)



if __name__ == "__main__":
    unittest.main()
