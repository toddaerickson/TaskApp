from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, time, datetime
from enum import Enum


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


# --- Tags ---
class TagCreate(BaseModel):
    name: str

class TagResponse(BaseModel):
    id: int
    name: str


# --- Tasks ---
class TaskCreate(BaseModel):
    title: str
    folder_id: Optional[int] = None
    note: Optional[str] = None
    priority: Optional[int] = 0
    status: Optional[str] = "none"
    starred: Optional[bool] = False
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    repeat_type: Optional[str] = "none"
    repeat_from: Optional[str] = "due_date"
    tag_ids: Optional[list[int]] = []

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[int] = None
    note: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    starred: Optional[bool] = None
    due_date: Optional[date] = None
    due_time: Optional[time] = None
    repeat_type: Optional[str] = None
    repeat_from: Optional[str] = None
    tag_ids: Optional[list[int]] = None

class TaskResponse(BaseModel):
    id: int
    title: str
    folder_id: Optional[int]
    folder_name: Optional[str] = None
    note: Optional[str]
    priority: int
    status: str
    starred: bool
    due_date: Optional[date]
    due_time: Optional[time]
    repeat_type: str
    repeat_from: str
    completed: bool
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    tags: list[TagResponse] = []

class TaskListResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int
    page: int
    per_page: int


# --- Batch ---
class BatchUpdate(BaseModel):
    task_ids: list[int]
    folder_id: Optional[int] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    starred: Optional[bool] = None
    completed: Optional[bool] = None
