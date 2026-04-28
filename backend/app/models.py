import re
from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional
from datetime import date, time, datetime


# Evidence-quality tier values surfaced as a UI chip on each exercise.
# Validated as a Pydantic Literal on create so an old client can't post
# a typo'd tier; existing rows without a tier read as NULL.
EvidenceTier = Literal["RCT", "MECHANISM", "PRACTITIONER", "THEORETICAL"]


# RFC 5322 is overkill; this catches the common mistakes without requiring
# the email-validator dep.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# Match HH:MM with leading zeros — 00:00..23:59. The missed-reminders
# route fans out integer parsing of this string in a tight loop; an
# unvalidated client could store "0:5" or "garbage" and either fail
# silently (the route's try/except eats it and skips the row) or run
# tests against an int(hh) that happens to land in [0, 23]. Validate
# at model-write time so the invariant is one place. PR-X3.
_REMINDER_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DAY_TOKENS = frozenset({"mon", "tue", "wed", "thu", "fri", "sat", "sun"})


def _validate_reminder_time(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not _REMINDER_TIME_RE.match(value):
        raise ValueError(
            "reminder_time must be HH:MM in 24h with leading zeros "
            "(e.g. '06:30' or '17:00'); got " + repr(value)
        )
    return value


def _validate_reminder_days(value: Optional[str]) -> Optional[str]:
    """CSV of weekday tokens or the literal 'daily'. Empty/None opts the
    routine out of reminders entirely. Tokens are normalized lowercase
    on read (`_parse_reminder_days` in routine_routes.py); the validator
    just gates the storable shape so a typo'd 'mun' on a write fails
    fast instead of silently dropping that day at read-time."""
    if value is None or value == "":
        return None
    norm = value.strip().lower()
    if norm == "daily":
        return "daily"
    parts = [p.strip() for p in norm.split(",") if p.strip()]
    if not parts:
        return None
    bad = [p for p in parts if p not in _DAY_TOKENS]
    if bad:
        raise ValueError(
            f"reminder_days contains unknown day tokens: {bad}. "
            "Allowed: mon,tue,wed,thu,fri,sat,sun (CSV) or 'daily'."
        )
    return ",".join(parts)



# --- Auth ---
class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=80)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("display_name")
    @classmethod
    def _normalize_display_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return (v or "").strip().lower()

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: int
    email: str
    display_name: Optional[str]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=80)

    @field_validator("display_name")
    @classmethod
    def _normalize_display_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


# --- Folders ---
class FolderCreate(BaseModel):
    name: str
    sort_order: Optional[int] = 0

class FolderUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None

class FolderResponse(BaseModel):
    id: int
    name: str
    sort_order: int
    task_count: Optional[int] = 0
    subfolders: list["SubfolderResponse"] = []


# --- Subfolders (within folders) ---
class SubfolderCreate(BaseModel):
    name: str
    sort_order: Optional[int] = 0

class SubfolderUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None

class SubfolderResponse(BaseModel):
    id: int
    folder_id: int
    name: str
    sort_order: int
    task_count: Optional[int] = 0


# --- Tags ---
class TagCreate(BaseModel):
    name: str

class TagResponse(BaseModel):
    id: int
    name: str


# --- Reminders ---
class ReminderCreate(BaseModel):
    remind_at: datetime

class ReminderResponse(BaseModel):
    id: int
    task_id: int
    remind_at: datetime
    reminded: bool
    created_at: datetime


# --- Tasks ---
class TaskCreate(BaseModel):
    title: str
    folder_id: Optional[int] = None
    subfolder_id: Optional[int] = None
    parent_id: Optional[int] = None
    note: Optional[str] = None
    priority: Optional[int] = 0
    status: Optional[str] = "none"
    starred: Optional[bool] = False
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    repeat_type: Optional[str] = "none"
    repeat_from: Optional[str] = "due_date"
    sort_order: Optional[int] = None
    tag_ids: Optional[list[int]] = []

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[int] = None
    subfolder_id: Optional[int] = None
    parent_id: Optional[int] = None
    note: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    starred: Optional[bool] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    repeat_type: Optional[str] = None
    repeat_from: Optional[str] = None
    sort_order: Optional[int] = None
    tag_ids: Optional[list[int]] = None

class TaskResponse(BaseModel):
    id: int
    title: str
    folder_id: Optional[int]
    folder_name: Optional[str] = None
    subfolder_id: Optional[int] = None
    subfolder_name: Optional[str] = None
    parent_id: Optional[int] = None
    note: Optional[str]
    priority: int
    status: str
    starred: bool
    start_date: Optional[date] = None
    due_date: Optional[date]
    due_time: Optional[time]
    repeat_type: str
    repeat_from: str
    sort_order: int = 0
    completed: bool
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    tags: list[TagResponse] = []
    subtasks: list["TaskResponse"] = []
    reminders: list[ReminderResponse] = []

class TaskListResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int
    page: int
    per_page: int

class ReorderRequest(BaseModel):
    task_ids: list[int]


# --- Batch ---
class BatchUpdate(BaseModel):
    task_ids: list[int]
    folder_id: Optional[int] = None
    subfolder_id: Optional[int] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    starred: Optional[bool] = None
    completed: Optional[bool] = None


# --- Workouts ---
class ExerciseImageResponse(BaseModel):
    id: int
    url: str
    caption: Optional[str] = None
    sort_order: int = 0
    # Screen-reader description. Hydrator substitutes a per-exercise default
    # ("{name} demonstration") when the column is NULL so VoiceOver always
    # announces something meaningful.
    alt_text: Optional[str] = None

class ExerciseImageCreate(BaseModel):
    url: str
    caption: Optional[str] = None
    sort_order: Optional[int] = 0
    alt_text: Optional[str] = None

class BulkImageEntry(BaseModel):
    slug: str
    urls: list[str]
    replace: Optional[bool] = False

class BulkImageRequest(BaseModel):
    entries: list[BulkImageEntry]

class BulkImageResult(BaseModel):
    slug: str
    status: str  # "ok", "not_found"
    added: int = 0
    replaced: int = 0

class ExerciseCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    category: Optional[str] = "strength"
    primary_muscle: Optional[str] = None
    equipment: Optional[str] = None
    difficulty: Optional[int] = 1
    is_bodyweight: Optional[bool] = False
    measurement: Optional[str] = "reps"
    instructions: Optional[str] = None
    cue: Optional[str] = None
    contraindications: Optional[str] = None
    min_age: Optional[int] = None
    max_age: Optional[int] = None
    # Evidence-quality tier (RCT / MECHANISM / PRACTITIONER / THEORETICAL).
    # Optional — operator-curated seed entries set it; user-created
    # exercises default to NULL and the chip stays hidden.
    evidence_tier: Optional[EvidenceTier] = None

class ExerciseUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    primary_muscle: Optional[str] = None
    equipment: Optional[str] = None
    difficulty: Optional[int] = None
    is_bodyweight: Optional[bool] = None
    measurement: Optional[str] = None
    instructions: Optional[str] = None
    cue: Optional[str] = None
    contraindications: Optional[str] = None
    # Operator-editable evidence tier. Symmetric with ExerciseCreate so the
    # operator can reclassify after seeding without going through the snapshot
    # path. Pydantic Literal still rejects typos.
    evidence_tier: Optional[EvidenceTier] = None

class ExerciseResponse(BaseModel):
    id: int
    user_id: Optional[int]
    name: str
    slug: Optional[str]
    category: str
    primary_muscle: Optional[str]
    equipment: Optional[str]
    difficulty: int
    is_bodyweight: bool
    measurement: str
    instructions: Optional[str]
    cue: Optional[str]
    contraindications: Optional[str]
    min_age: Optional[int]
    max_age: Optional[int]
    # ISO timestamp when archived, NULL while active. Mobile renders
    # archived rows grayed-out with a Restore affordance.
    archived_at: Optional[datetime] = None
    # Evidence-quality tier; null hides the chip in the UI. Same Literal
    # both directions so OpenAPI consumers see one type contract — and
    # so a malformed DB row surfaces as a 500 the operator can debug
    # rather than as a "string" the UI silently fails to render.
    evidence_tier: Optional[EvidenceTier] = None
    images: list[ExerciseImageResponse] = []


class RoutineExerciseCreate(BaseModel):
    exercise_id: int
    sort_order: Optional[int] = 0
    target_sets: Optional[int] = 1
    target_reps: Optional[int] = None
    target_weight: Optional[float] = None
    target_duration_sec: Optional[int] = None
    rest_sec: Optional[int] = 60
    tempo: Optional[str] = None
    keystone: Optional[bool] = False
    notes: Optional[str] = None
    # Target RPE per working set, 1-10. Null = no target; session logger
    # falls back to whatever the user types inline. Bounded here so bogus
    # values from an old client land as a 422 instead of persisting.
    target_rpe: Optional[int] = Field(default=None, ge=1, le=10)

class RoutineExerciseResponse(RoutineExerciseCreate):
    id: int
    routine_id: int
    updated_at: Optional[datetime] = None
    exercise: Optional[ExerciseResponse] = None


class RoutineCreate(BaseModel):
    name: str
    goal: Optional[str] = "general"
    notes: Optional[str] = None
    sort_order: Optional[int] = 0
    reminder_time: Optional[str] = None    # "HH:MM"
    reminder_days: Optional[str] = None    # CSV of mon..sun or "daily"
    # When True, sessions started from this routine inherit the flag and
    # get pain-monitored progression. Default False keeps strength
    # routines untouched.
    tracks_symptoms: Optional[bool] = False
    # Wall-clock estimate, 1-180 minutes. NULL = unspecified; mobile
    # hides the duration pill on the routine card.
    target_minutes: Optional[int] = Field(default=None, ge=1, le=180)
    exercises: Optional[list[RoutineExerciseCreate]] = []

    @field_validator("reminder_time")
    @classmethod
    def _check_reminder_time(cls, v: Optional[str]) -> Optional[str]:
        return _validate_reminder_time(v)

    @field_validator("reminder_days")
    @classmethod
    def _check_reminder_days(cls, v: Optional[str]) -> Optional[str]:
        return _validate_reminder_days(v)


class RoutineUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None
    reminder_time: Optional[str] = None
    reminder_days: Optional[str] = None
    tracks_symptoms: Optional[bool] = None
    target_minutes: Optional[int] = Field(default=None, ge=1, le=180)
    # Optimistic concurrency (Phase 7.4). When present, server returns 409
    # if the row's current updated_at has moved past this value since the
    # client's last GET. Omit to opt out (silent last-write-wins).
    expected_updated_at: Optional[datetime] = None

    @field_validator("reminder_time")
    @classmethod
    def _check_reminder_time(cls, v: Optional[str]) -> Optional[str]:
        return _validate_reminder_time(v)

    @field_validator("reminder_days")
    @classmethod
    def _check_reminder_days(cls, v: Optional[str]) -> Optional[str]:
        return _validate_reminder_days(v)

class RoutineResponse(BaseModel):
    id: int
    user_id: int
    name: str
    goal: str
    notes: Optional[str]
    sort_order: int
    reminder_time: Optional[str] = None
    reminder_days: Optional[str] = None
    tracks_symptoms: bool = False
    target_minutes: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    exercises: list[RoutineExerciseResponse] = []


class MissedReminder(BaseModel):
    """Surfaced by `GET /routines/missed-reminders` — V1 of the routine
    reminder UX (in lieu of full web push). One row per routine that
    was scheduled for today, the reminder_time has passed, and no
    session has been started since. Lives in models.py rather than
    the route file so the schema can be referenced from the
    `app/reminders.py` extracted helper without a circular import.
    PR-X4 architectural cleanup."""
    routine_id: int
    name: str
    goal: str
    reminder_time: str  # "HH:MM"
    expected_at: datetime
    target_minutes: Optional[int] = None


# Portable JSON format for routine import/export. Uses `slug` instead of
# `exercise_id` so a routine authored against one user's library survives
# import into another user's library — as long as the seeded slugs match.
class RoutineImportExercise(BaseModel):
    slug: str
    target_sets: Optional[int] = 1
    target_reps: Optional[int] = None
    target_weight: Optional[float] = None
    target_duration_sec: Optional[int] = None
    rest_sec: Optional[int] = 60
    tempo: Optional[str] = None
    keystone: Optional[bool] = False
    notes: Optional[str] = None

class RoutineImportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    goal: Optional[str] = "general"
    notes: Optional[str] = None
    # Cap is well above realistic authoring. Exists to keep a malicious or
    # confused client from building a `slug IN (?,?...)` lookup that
    # exceeds SQLite's 32,766 parameter cap — the request would 500 mid-
    # transaction and take a handler worker with it.
    exercises: list[RoutineImportExercise] = Field(default_factory=list, max_length=200)


class SessionSetCreate(BaseModel):
    exercise_id: int
    set_number: Optional[int] = None  # server-assigned when omitted
    reps: Optional[int] = None
    weight: Optional[float] = None
    duration_sec: Optional[int] = None
    distance_m: Optional[float] = None
    rpe: Optional[int] = None
    # Per-set pain 0-10. The server only persists it when the parent
    # session was created with tracks_symptoms=true; on a strength
    # session the field is ignored so stray values can't pollute later
    # suggestions.
    pain_score: Optional[int] = Field(default=None, ge=0, le=10)
    # Laterality: 'left' | 'right' | None (bilateral). None keeps
    # historical behavior. A Literal type would force a client update
    # dance for older apps mid-rollout; the route layer normalizes any
    # other string to NULL.
    side: Optional[str] = None
    # Warmup flag. Warmup sets are excluded from volume aggregation and
    # the progression suggestion (once the suggester learns about them).
    is_warmup: Optional[bool] = False
    completed: Optional[bool] = True
    notes: Optional[str] = None

class SessionSetResponse(SessionSetCreate):
    id: int
    session_id: int

class SessionSetUpdate(BaseModel):
    """PATCH-able fields on a logged set. Original caller was the pain
    chip (pain_score backfill); extended with the numeric performance
    fields when the tap-row-to-edit UX landed so users can correct a
    mis-typed rep count without deleting and re-logging.

    Structural fields (set_number, session_id, exercise_id) are
    intentionally excluded — mutating them would break the session
    timeline and PR computations."""
    reps: Optional[int] = None
    weight: Optional[float] = None
    duration_sec: Optional[int] = None
    distance_m: Optional[float] = None
    rpe: Optional[int] = Field(default=None, ge=1, le=10)
    pain_score: Optional[int] = Field(default=None, ge=0, le=10)
    side: Optional[str] = None
    is_warmup: Optional[bool] = None
    notes: Optional[str] = None

class SessionCreate(BaseModel):
    routine_id: Optional[int] = None
    notes: Optional[str] = None

class SessionUpdate(BaseModel):
    ended_at: Optional[datetime] = None
    rpe: Optional[int] = None
    mood: Optional[int] = None
    notes: Optional[str] = None

class SessionResponse(BaseModel):
    id: int
    user_id: int
    routine_id: Optional[int]
    started_at: datetime
    ended_at: Optional[datetime]
    rpe: Optional[int]
    mood: Optional[int]
    notes: Optional[str]
    # Session-time snapshot of the starting routine's tracks_symptoms.
    # Clients read this to decide whether to render pain UX.
    tracks_symptoms: bool = False
    sets: list[SessionSetResponse] = []


class ExerciseBest(BaseModel):
    """Per-exercise historical bests across a user's prior sessions. Used
    to decide whether a newly-logged set is a personal record."""
    exercise_id: int
    max_weight: Optional[float] = None
    max_reps: Optional[int] = None
    max_duration_sec: Optional[int] = None


class SymptomLogCreate(BaseModel):
    body_part: str
    severity: int
    notes: Optional[str] = None
    session_id: Optional[int] = None

class SymptomLogResponse(BaseModel):
    id: int
    user_id: int
    session_id: Optional[int]
    body_part: str
    severity: int
    notes: Optional[str]
    logged_at: datetime


class SymptomLogUpdate(BaseModel):
    body_part: Optional[str] = None
    severity: Optional[int] = Field(default=None, ge=0, le=10)
    notes: Optional[str] = None


# Rebuild forward refs
TaskResponse.model_rebuild()
FolderResponse.model_rebuild()
