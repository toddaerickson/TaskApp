from pydantic import BaseModel
from typing import Optional
from datetime import date, time, datetime


# --- Auth ---
class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: int
    email: str
    display_name: Optional[str]


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

class RoutineExerciseResponse(RoutineExerciseCreate):
    id: int
    routine_id: int
    exercise: Optional[ExerciseResponse] = None

class RoutineCreate(BaseModel):
    name: str
    goal: Optional[str] = "general"
    notes: Optional[str] = None
    sort_order: Optional[int] = 0
    reminder_time: Optional[str] = None    # "HH:MM"
    reminder_days: Optional[str] = None    # CSV of mon..sun or "daily"
    exercises: Optional[list[RoutineExerciseCreate]] = []

class RoutineUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None
    reminder_time: Optional[str] = None
    reminder_days: Optional[str] = None

class RoutineResponse(BaseModel):
    id: int
    user_id: int
    name: str
    goal: str
    notes: Optional[str]
    sort_order: int
    reminder_time: Optional[str] = None
    reminder_days: Optional[str] = None
    created_at: datetime
    exercises: list[RoutineExerciseResponse] = []


class SessionSetCreate(BaseModel):
    exercise_id: int
    set_number: Optional[int] = None  # server-assigned when omitted
    reps: Optional[int] = None
    weight: Optional[float] = None
    duration_sec: Optional[int] = None
    distance_m: Optional[float] = None
    rpe: Optional[int] = None
    completed: Optional[bool] = True
    notes: Optional[str] = None

class SessionSetResponse(SessionSetCreate):
    id: int
    session_id: int

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
    sets: list[SessionSetResponse] = []


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


# Rebuild forward refs
TaskResponse.model_rebuild()
FolderResponse.model_rebuild()
