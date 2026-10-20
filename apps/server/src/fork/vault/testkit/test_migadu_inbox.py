"""Synthetic message and IMAP acceptance for the operator-only Migadu reader."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
import imaplib
import json
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
            return "NO", [b"private-provider-error-canary"]
        uid = int(str(args[0]))
        body = self.bodies[uid]
        header_only = "HEADER.FIELDS" in str(args[-1])
        if header_only:
            parsed = BytesParser(policy=policy.default).parsebytes(body)
            selected = EmailMessage()
            for name in ("From", *inbox.RECIPIENT_HEADERS):
                for value in parsed.get_all(name, []):
                    selected[name] = str(value)
            body = selected.as_bytes()
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
        client = FixtureClient()
        now = [NOW]
        client.fetch_hook = lambda: now.__setitem__(0, REQUEST.started_at + inbox.WINDOW)
        with self.assertRaisesRegex(inbox.InboxError, "window"):
            self.read(client, clock=lambda: now[0])
        self.assertTrue(client.closed)

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

    def test_large_message_is_rejected_before_body_download_and_header_size_is_bounded(self):
        large = FixtureClient()
        large.reported_size = inbox.MAX_MESSAGE_BYTES + 1
        self.assertEqual(self.read(large)["messages"], [])
        self.assertEqual(large.body_fetches, [])
        headers = FixtureClient({1: message(extra={"X-Original-To": "x" * inbox.MAX_HEADER_BYTES})})
        with self.assertRaisesRegex(inbox.InboxError, "headers"):
            self.read(headers)
        self.assertEqual(headers.body_fetches, [])

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

    def test_large_decoded_text_refuses_instead_of_truncating_a_verification_message(self):
        client = FixtureClient({1: message(text="x" * (inbox.MAX_TEXT_BYTES + 1))})
        with self.assertRaisesRegex(inbox.InboxError, "text exceeds"):
            self.read(client)

    def test_login_and_read_errors_never_disclose_provider_messages(self):
        for operation in ("login", "fetch"):
            client = FixtureClient()
            client.failed_login = operation == "login"
            client.failed_fetch = operation == "fetch"
            with self.subTest(operation=operation), self.assertRaises(inbox.InboxError) as error:
                self.read(client)
            self.assertNotIn("private-provider-error-canary", str(error.exception))
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
