import re
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import date, time, datetime


# RFC 5322 is overkill; this catches the common mistakes without requiring
# the email-validator dep.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_iso_date_opt(v: Optional[str]) -> Optional[str]:
    """ISO-8601 date validator shared by any Pydantic field that stores a
    date as a string (phase_start_date, scheduling hints, etc.). Empty
    string or None → None (clears the field). Any other value must parse
    via date.fromisoformat, otherwise the field raises ValueError so the
    caller gets a 422 instead of silently storing "not-a-date" and then
    failing at render time."""
    if v is None or v == "":
        return None
    try:
        date.fromisoformat(v)
    except ValueError as e:
        raise ValueError(f"must be an ISO date (YYYY-MM-DD): {e}")
    return v


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

class ExerciseImageCreate(BaseModel):
    url: str
    caption: Optional[str] = None
    sort_order: Optional[int] = 0

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
    # Null means the exercise applies in every phase (e.g. a warmup the
    # user runs on every session regardless of progression).
    phase_id: Optional[int] = None

class RoutineExerciseResponse(RoutineExerciseCreate):
    id: int
    routine_id: int
    updated_at: Optional[datetime] = None
    exercise: Optional[ExerciseResponse] = None


class PhaseCreate(BaseModel):
    label: str
    order_idx: int
    duration_weeks: int
    notes: Optional[str] = None

class PhaseUpdate(BaseModel):
    label: Optional[str] = None
    order_idx: Optional[int] = None
    duration_weeks: Optional[int] = None
    notes: Optional[str] = None

class PhaseResponse(BaseModel):
    id: int
    routine_id: int
    label: str
    order_idx: int
    duration_weeks: int
    notes: Optional[str] = None


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
    exercises: Optional[list[RoutineExerciseCreate]] = []

class RoutineUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None
    reminder_time: Optional[str] = None
    reminder_days: Optional[str] = None
    # ISO date "YYYY-MM-DD". Marks when phase 0 of a phased routine
    # begins. Null = routine is not phased.
    phase_start_date: Optional[str] = None
    tracks_symptoms: Optional[bool] = None
    # Optimistic concurrency (Phase 7.4). When present, server returns 409
    # if the row's current updated_at has moved past this value since the
    # client's last GET. Omit to opt out (silent last-write-wins).
    expected_updated_at: Optional[datetime] = None

    @field_validator("phase_start_date")
    @classmethod
    def _v_phase_start_date(cls, v: Optional[str]) -> Optional[str]:
        return _validate_iso_date_opt(v)

class RoutineResponse(BaseModel):
    id: int
    user_id: int
    name: str
    goal: str
    notes: Optional[str]
    sort_order: int
    reminder_time: Optional[str] = None
    reminder_days: Optional[str] = None
    phase_start_date: Optional[str] = None
    tracks_symptoms: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None
    exercises: list[RoutineExerciseResponse] = []
    phases: list[PhaseResponse] = []
    # Server-resolved current phase based on phase_start_date + durations.
    # Null when the routine has no phases or phase_start_date is null.
    current_phase_id: Optional[int] = None


# Portable JSON format for routine import/export. Uses `slug` instead of
# `exercise_id` so a routine authored against one user's library survives
# import into another user's library — as long as the seeded slugs match.
# `phase_idx` is a 0-based pointer into `phases[]`; null = applies in
# every phase. Resolved server-side to a real phase_id after the phases
# are created.
class RoutineImportPhase(BaseModel):
    label: str
    duration_weeks: int = Field(ge=1, le=520)
    notes: Optional[str] = None

class RoutineImportExercise(BaseModel):
    slug: str
    phase_idx: Optional[int] = None
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
    phase_start_date: Optional[str] = None  # "YYYY-MM-DD"; null = flat
    # Caps are well above realistic authoring (a Curovate protocol tops out
    # at 4-6 phases and ~30 exercises). They exist to keep a malicious or
    # confused client from building a `slug IN (?,?...)` lookup that
    # exceeds SQLite's 32,766 parameter cap — the request would 500 mid-
    # transaction and take a handler worker with it.
    phases: list[RoutineImportPhase] = Field(default_factory=list, max_length=20)
    exercises: list[RoutineImportExercise] = Field(default_factory=list, max_length=200)

    @field_validator("phase_start_date")
    @classmethod
    def _v_phase_start_date(cls, v: Optional[str]) -> Optional[str]:
        return _validate_iso_date_opt(v)


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
