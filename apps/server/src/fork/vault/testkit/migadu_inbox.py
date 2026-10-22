"""Gated Migadu read-only transport contract, exercised only with synthetic test connections."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email import policy
from email.errors import MessageError, ObsoleteHeaderDefect, UndecodableBytesDefect
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses
import imaplib
import re
import ssl
import sys
import time
from typing import Any, Callable, Protocol


MAILBOX = "vault@begam.in"
READER = "vault-reader@begam.in"
HOST = "imap.migadu.com"
WINDOW = timedelta(minutes=15)
UID_WINDOW = 64
MAX_MATCHES = 3
MAX_MESSAGE_BYTES = 262_144
MAX_TEXT_BYTES = 65_536
MAX_HEADER_BYTES = 16_384
MAX_TRANSFER_BYTES = 2_000_000
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
RECIPIENT_HEADERS = ("To", "Cc", "Delivered-To", "X-Original-To")
HEADER_PART = "BODY.PEEK[HEADER.FIELDS (FROM TO CC DELIVERED-TO X-ORIGINAL-TO)]"


class InboxError(Exception):
    """Public failures use fixed messages, never server replies or message content."""


class UnusableMessage(InboxError):
    """A fixed per-candidate reason, without withdrawing other UIDs' usable text."""


@dataclass(frozen=True)
class Credentials:
    username: str
    password: str = field(repr=False)


@dataclass(frozen=True)
class Request:
    run_id: str
    started_at: datetime
    expected_sender: str

    @property
    def folder(self) -> str:
        return "loom-" + self.run_id

    @property
    def recipient(self) -> str:
        return "vault+" + self.folder + "@begam.in"


def address(value: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9._+\-]{0,63}@[a-z0-9][a-z0-9.\-]{0,189}", value):
        raise InboxError("Use an explicit lowercase ASCII email address.")
    return value


def validate_request(request: Request, now: datetime) -> None:
    if (not re.fullmatch(r"[a-f0-9]{32}", request.run_id)
            or request.started_at.tzinfo is None or now.tzinfo is None):
        raise InboxError("Use a 32-character lowercase hex run ID and an aware start time.")
    address(request.expected_sender)
    if not request.started_at <= now < request.started_at + WINDOW:
        raise InboxError("The test-mail request is outside its fifteen-minute window.")


class Client(Protocol):
    def login(self, username: str, password: str) -> tuple[str, Any]: ...
    def select(self, mailbox: str, readonly: bool = False) -> tuple[str, Any]: ...
    def response(self, code: str) -> tuple[str, Any]: ...
    def uid(self, command: str, *args: Any) -> tuple[str, Any]: ...
    def status(self, mailbox: str, names: str) -> tuple[str, Any]: ...
    def logout(self) -> Any: ...
    def shutdown(self) -> None: ...


class BoundedImap(imaplib.IMAP4_SSL):
    def __init__(self) -> None:
        self._deadline = time.monotonic() + 30
        self._budget = MAX_TRANSFER_BYTES
        # IMAP4_SSL's default context does not verify certificates on every supported Python.
        super().__init__(HOST, 993, ssl_context=ssl.create_default_context(), timeout=10)

    def _check_read(self) -> None:
        remaining = self._deadline - time.monotonic()
        if remaining <= 0 or self._budget <= 0:
            raise InboxError("The bounded mail read did not complete.")
        self.sock.settimeout(min(10, remaining))

    def _count(self, value: bytes) -> bytes:
        self._budget -= len(value)
        if self._budget < 0:
            raise InboxError("The mail response exceeded the read limit.")
        return value

    def read(self, size: int) -> bytes:
        if not 0 <= size <= min(MAX_MESSAGE_BYTES + 1, self._budget):
            raise InboxError("The mail literal exceeded the read limit.")
        self._check_read()
        return self._count(super().read(size))

    def readline(self) -> bytes:
        self._check_read()
        return self._count(super().readline())


def number(client: Client, name: str) -> int:
    _, data = client.response(name)
    if len(data) != 1 or not isinstance(data[0], bytes) or not re.fullmatch(rb"[1-9][0-9]{0,9}", data[0]):
        raise InboxError("The mailbox did not supply a valid UID boundary.")
    return int(data[0])


def literal(data: Any, uid: int) -> tuple[bytes, bytes, datetime, int]:
    parts = [part for part in data if isinstance(part, tuple)]
    if len(parts) != 1 or len(parts[0]) != 2:
        raise InboxError("The mailbox returned an unsupported message response.")
    metadata, body = parts[0]
    if not isinstance(metadata, bytes) or not isinstance(body, bytes):
        raise InboxError("The mailbox returned an unsupported message response.")
    identity = re.search(rb"\bUID ([0-9]+)\b", metadata)
    size = re.search(rb"\bRFC822.SIZE ([0-9]+)\b", metadata)
    arrival = re.search(rb'INTERNALDATE "([ 0-9][0-9])-([A-Za-z]{3})-([0-9]{4}) ([0-9:]{8}) ([+\-][0-9]{4})"', metadata)
    if identity is None or int(identity[1]) != uid or size is None or arrival is None:
        raise InboxError("The mailbox returned mismatched message metadata.")
    try:
        day, month, year, clock, offset = (part.decode("ascii") for part in arrival.groups())
        hours, minutes, seconds = (int(part) for part in clock.split(":"))
        zone_minutes = (int(offset[1:3]) * 60 + int(offset[3:])) * (1 if offset[0] == "+" else -1)
        received_at = datetime(int(year), MONTHS.index(month) + 1, int(day), hours, minutes, seconds,
                               tzinfo=timezone(timedelta(minutes=zone_minutes)))
    except (ValueError, UnicodeError):
        raise InboxError("The mailbox returned an invalid arrival time.") from None
    return metadata, body, received_at, int(size[1])


def routing_headers(message: EmailMessage) -> list[tuple[str, str]]:
    # BODY.PEEK[HEADER.FIELDS] omits MIME structure; compare only the fields actually observed.
    names = {"from", *(name.lower() for name in RECIPIENT_HEADERS)}
    return sorted((name.lower(), value.replace("\r\n", "\n")) for name, value in message.raw_items()
                  if name.lower() in names)


def matches(message: EmailMessage, request: Request) -> bool:
    try:
        from_headers = message.get_all("From", [])
        recipient_headers = [value for name in RECIPIENT_HEADERS for value in message.get_all(name, [])]
        # Display-name punctuation and raw UTF-8 do not change the strictly parsed addresses.
        if (message.defects or len(from_headers) != 1
                or any(not isinstance(defect, (ObsoleteHeaderDefect, UndecodableBytesDefect))
                       for value in [*from_headers, *recipient_headers] for defect in value.defects)):
            return False
        senders = getaddresses([str(value) for value in from_headers], strict=True)
        recipients = getaddresses([str(value) for value in recipient_headers], strict=True)
    except (MessageError, LookupError, TypeError, ValueError, RecursionError):
        return False
    if len(senders) != 1 or senders[0][1].lower() != request.expected_sender:
        return False
    addresses = {value.lower() for _, value in recipients}
    # Multiple run aliases are ambiguous even when this request's recipient is also present.
    run_addresses = {value for value in addresses if value.startswith("vault+loom-")}
    return request.recipient in addresses and run_addresses == {request.recipient}


def fetch_unavailable(kind: str, data: Any) -> bool:
    # NO does not prove expungement, so expose uncertainty rather than infer absence or pending mail.
    return kind == "NO" or (kind == "OK" and (data is None or isinstance(data, (list, tuple))
                                            and all(part is None or isinstance(part, bytes) for part in data)))


def plain_text(message: EmailMessage) -> str:
    result: list[str] = []
    remaining_parts = 32

    def visit(part: EmailMessage) -> None:
        nonlocal remaining_parts
        remaining_parts -= 1
        if remaining_parts < 0:
            raise UnusableMessage("too-many-mime-parts")
        if part.defects:
            raise UnusableMessage("invalid-mime")
        if part.get_content_disposition() == "attachment" or part.get_filename() is not None:
            return
        if part.get_content_type() == "text/plain":
            try:
                text = part.get_content()
            except (LookupError, ValueError, TypeError):
                raise UnusableMessage("unsupported-text-encoding") from None
            if not isinstance(text, str):
                raise UnusableMessage("unsupported-text-encoding")
            if part.defects:
                raise UnusableMessage("invalid-mime")
            result.append(text)
        elif part.get_content_maintype() == "multipart":
            for child in part.iter_parts():
                visit(child)
        # Forwarded messages, HTML, attachments and external resources are never rendered or followed.

    try:
        visit(message)
    except UnusableMessage:
        raise
    except (MessageError, LookupError, ValueError, TypeError, RecursionError):
        raise UnusableMessage("invalid-mime") from None
    text = "\n".join(result)
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise UnusableMessage("text-too-large")
    return text


def read_once(credentials: Credentials, request: Request, *,
              connect: Callable[[], Client] | None = None,
              clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> dict[str, Any]:
    if sys.version_info < (3, 13):
        raise InboxError("The inbox transport contract requires Python 3.13 or newer.")
    validate_request(request, clock())
    if connect is None:
        raise InboxError("Live Migadu reads are disabled pending L79 custody and reader setup.")
    if (credentials.username != READER or not credentials.password or len(credentials.password) > 4096
            or any(not 32 <= ord(char) < 127 for char in credentials.password)):
        raise InboxError("Use the dedicated Migadu test-reader identity.")
    client: Client | None = None
    try:
        client = connect()
        if client.login(credentials.username, credentials.password)[0] != "OK":
            raise InboxError("The dedicated test reader could not authenticate.")
        folder = request.folder
        if client.select(folder, readonly=True)[0] != "OK":
            folder = "INBOX"
            if client.select(folder, readonly=True)[0] != "OK":
                raise InboxError("The dedicated test folder is unavailable.")
        validity, next_uid = number(client, "UIDVALIDITY"), number(client, "UIDNEXT")
        lower = max(1, next_uid - UID_WINDOW)
        messages: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        if next_uid > 1:
            kind, data = client.uid("SEARCH", None, "UID", f"{lower}:{next_uid - 1}")
            if kind != "OK" or len(data) != 1 or not isinstance(data[0], bytes):
                raise InboxError("The test-message search failed.")
            words = data[0].split()
            if len(words) > UID_WINDOW or any(not re.fullmatch(rb"[1-9][0-9]{0,9}", word) for word in words):
                raise InboxError("The mailbox returned an unbounded search result.")
            uids = [int(word) for word in words]
            if len(set(uids)) != len(uids) or any(not lower <= uid < next_uid for uid in uids):
                raise InboxError("The mailbox returned mismatched search results.")
            for uid in sorted(uids, reverse=True):
                validate_request(request, clock())
                kind, data = client.uid("FETCH", str(uid), f"(UID INTERNALDATE RFC822.SIZE {HEADER_PART})")
                if fetch_unavailable(kind, data):
                    candidates.append({"uid": uid, "status": "unavailable", "reason": "message-unavailable"})
                    continue
                if kind != "OK":
                    raise InboxError("The test-message read failed.")
                _, headers, arrived, size = literal(data, uid)
                if not request.started_at.replace(microsecond=0) <= arrived <= clock():
                    continue
                if len(headers) > MAX_HEADER_BYTES:
                    candidates.append({"uid": uid, "status": "unclassified", "reason": "headers-too-large"})
                    continue
                try:
                    header = BytesParser(policy=policy.default).parsebytes(headers)
                except (MessageError, LookupError, TypeError, ValueError, RecursionError):
                    continue
                if not matches(header, request):
                    continue
                if not 0 < size <= MAX_MESSAGE_BYTES:
                    candidates.append({"uid": uid, "status": "unusable", "reason": "message-too-large"})
                    continue
                kind, data = client.uid("FETCH", str(uid), f"(UID INTERNALDATE RFC822.SIZE BODY.PEEK[]<0.{MAX_MESSAGE_BYTES + 1}>)")
                if fetch_unavailable(kind, data):
                    candidates.append({"uid": uid, "status": "unavailable", "reason": "message-unavailable"})
                    continue
                if kind != "OK":
                    raise InboxError("The test-message read failed.")
                _, body, body_arrived, body_size = literal(data, uid)
                if body_arrived != arrived or body_size != size or len(body) != size:
                    raise InboxError("The test message changed during its read.")
                try:
                    message = BytesParser(policy=policy.default).parsebytes(body)
                except (MessageError, LookupError, TypeError, ValueError, RecursionError):
                    candidates.append({"uid": uid, "status": "unusable", "reason": "invalid-mime"})
                    continue
                if message.defects:
                    candidates.append({"uid": uid, "status": "unusable", "reason": "invalid-mime"})
                    continue
                if routing_headers(message) != routing_headers(header):
                    raise InboxError("The test message changed during its read.")
                try:
                    text = plain_text(message)
                except UnusableMessage as error:
                    candidates.append({"uid": uid, "status": "unusable", "reason": str(error)})
                    continue
                messages.append({"uid": uid, "receivedAt": arrived.isoformat(), "text": text})
                if len(messages) == MAX_MATCHES:
                    break
        # STATUS observes the current epoch; response() would only return the cached EXAMINE value.
        kind, data = client.status(folder, "(UIDVALIDITY)")
        current = re.search(rb"\bUIDVALIDITY ([0-9]+)\b", data[0]) if kind == "OK" and data and isinstance(data[0], bytes) else None
        if current is None or int(current[1]) != validity:
            raise InboxError("The mailbox changed during the read. Retry with a fresh observation.")
        validate_request(request, clock())
        result = {"runId": request.run_id, "recipient": request.recipient, "folder": folder,
                "uidValidity": validity, "uidNext": next_uid, "coverage": "bounded-latest-64-uids",
                "status": ("found" if messages else "unusable-candidates"
                           if any(candidate["status"] == "unusable" for candidate in candidates)
                           else "incomplete-in-bounded-window" if candidates else "pending-in-bounded-window"),
                "messages": messages, "candidates": candidates, "readOnly": True, "senderAuthenticated": False,
                "canReadLive": False, "canExecute": False, "automaticResumption": False,
                "automaticVerification": False, "allowOnceConsumption": False}
    except InboxError:
        raise
    except (imaplib.IMAP4.error, OSError, ValueError, TypeError, AttributeError, IndexError, MessageError, RecursionError):
        raise InboxError("The dedicated test inbox is unavailable or returned an unsupported response.") from None
    finally:
        if client is not None:
            try:
                client.logout()
            except (InboxError, imaplib.IMAP4.error, OSError):
                pass
            finally:
                try:
                    client.shutdown()
                except (OSError, AttributeError):
                    pass
    validate_request(request, clock())
    return result
