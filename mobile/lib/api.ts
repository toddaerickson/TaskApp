import axios from 'axios';
import { Platform } from 'react-native';

const BASE_URL = 'http://localhost:8000';

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use(async (config) => {
  let token: string | null = null;
  if (Platform.OS === 'web') {
    token = localStorage.getItem('token');
  } else {
    const SecureStore = require('expo-secure-store');
    token = await SecureStore.getItemAsync('token');
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Auth ---
export async function register(email: string, password: string, displayName?: string) {
  const { data } = await api.post('/auth/register', { email, password, display_name: displayName });
  return data;
}

export async function login(email: string, password: string) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data;
}

// --- Folders ---
export async function getFolders() {
  const { data } = await api.get('/folders');
  return data;
}

export async function createFolder(name: string, sortOrder?: number) {
  const { data } = await api.post('/folders', { name, sort_order: sortOrder ?? 0 });
  return data;
}

export async function deleteFolder(id: number) {
  await api.delete(`/folders/${id}`);
}

// --- Subfolders (within folders) ---
export async function getSubfolders(folderId: number) {
  const { data } = await api.get(`/folders/${folderId}/subfolders`);
  return data;
}

export async function createSubfolder(folderId: number, name: string, sortOrder?: number) {
  const { data } = await api.post(`/folders/${folderId}/subfolders`, { name, sort_order: sortOrder ?? 0 });
  return data;
}

export async function deleteSubfolder(id: number) {
  await api.delete(`/subfolders/${id}`);
}

// --- Tags ---
export async function getTags() {
  const { data } = await api.get('/tags');
  return data;
}

export async function createTag(name: string) {
  const { data } = await api.post('/tags', { name });
  return data;
}

export async function deleteTag(id: number) {
  await api.delete(`/tags/${id}`);
}

// --- Tasks ---
export interface TaskFilters {
  folder_id?: number;
  subfolder_id?: number;
  parent_id?: number;
  top_level_only?: boolean;
  status?: string;
  priority?: number;
  tag?: string;
  starred?: boolean;
  completed?: boolean;
  search?: string;
  hide_future_start?: boolean;
  sort?: string;
  order?: string;
  page?: number;
  per_page?: number;
}

export async function getTasks(filters: TaskFilters = {}) {
  const { data } = await api.get('/tasks', { params: filters });
  return data;
}

export async function getTask(id: number) {
  const { data } = await api.get(`/tasks/${id}`);
  return data;
}

export async function createTask(task: any) {
  const { data } = await api.post('/tasks', task);
  return data;
}

export async function updateTask(id: number, updates: any) {
  const { data } = await api.put(`/tasks/${id}`, updates);
  return data;
}

export async function deleteTask(id: number) {
  await api.delete(`/tasks/${id}`);
}

export async function completeTask(id: number) {
  const { data } = await api.post(`/tasks/${id}/complete`);
  return data;
}

export async function reorderTasks(taskIds: number[]) {
  const { data } = await api.post('/tasks/reorder', { task_ids: taskIds });
  return data;
}

export async function batchUpdate(taskIds: number[], updates: any) {
  const { data } = await api.post('/tasks/batch', { task_ids: taskIds, ...updates });
  return data;
}

// --- Reminders ---
export async function addReminder(taskId: number, remindAt: string) {
  const { data } = await api.post(`/tasks/${taskId}/reminders`, { remind_at: remindAt });
  return data;
}

export async function getReminders(taskId: number) {
  const { data } = await api.get(`/tasks/${taskId}/reminders`);
  return data;
}

export async function deleteReminder(id: number) {
  await api.delete(`/reminders/${id}`);
}

export async function getUpcomingReminders(limit: number = 20) {
  const { data } = await api.get('/reminders/upcoming', { params: { limit } });
  return data;
}

// --- Workouts: Exercises ---
export async function getExercises(params?: { category?: string; search?: string }) {
  const { data } = await api.get('/exercises', { params });
  return data;
}

export async function getExercise(id: number) {
  const { data } = await api.get(`/exercises/${id}`);
  return data;
}

export async function createExercise(payload: any) {
  const { data } = await api.post('/exercises', payload);
  return data;
}

export async function updateExercise(id: number, updates: any) {
  const { data } = await api.put(`/exercises/${id}`, updates);
  return data;
}

export async function updateRoutine(id: number, updates: any) {
  const { data } = await api.put(`/routines/${id}`, updates);
  return data;
}

export async function updateRoutineExercise(routineExerciseId: number, updates: any) {
  const { data } = await api.put(`/routines/exercises/${routineExerciseId}`, updates);
  return data;
}

export async function reorderRoutineExercises(routineId: number, routineExerciseIds: number[]) {
  const { data } = await api.post(`/routines/${routineId}/reorder`, {
    routine_exercise_ids: routineExerciseIds,
  });
  return data;
}

export async function bulkExerciseImages(entries: { slug: string; urls: string[]; replace?: boolean }[]) {
  const { data } = await api.post('/exercises/images/bulk', { entries });
  return data as { slug: string; status: string; added: number; replaced: number }[];
}

export async function addExerciseImage(exerciseId: number, url: string, caption?: string) {
  const { data } = await api.post(`/exercises/${exerciseId}/images`, { url, caption });
  return data;
}

export async function deleteExerciseImage(imageId: number) {
  await api.delete(`/exercises/images/${imageId}`);
}

// --- Workouts: Routines ---
export async function getRoutines() {
  const { data } = await api.get('/routines');
  return data;
}

export async function getRoutine(id: number) {
  const { data } = await api.get(`/routines/${id}`);
  return data;
}

export async function createRoutine(payload: any) {
  const { data } = await api.post('/routines', payload);
  return data;
}

export async function deleteRoutine(id: number) {
  await api.delete(`/routines/${id}`);
}

export async function addExerciseToRoutine(routineId: number, payload: any) {
  const { data } = await api.post(`/routines/${routineId}/exercises`, payload);
  return data;
}

export async function removeExerciseFromRoutine(routineExerciseId: number) {
  await api.delete(`/routines/exercises/${routineExerciseId}`);
}

// --- Workouts: Sessions ---
export async function startSession(routineId?: number, notes?: string) {
  const { data } = await api.post('/sessions', { routine_id: routineId, notes });
  return data;
}

export async function getSession(id: number) {
  const { data } = await api.get(`/sessions/${id}`);
  return data;
}

export async function listSessions(params?: { limit?: number; routine_id?: number }) {
  const { data } = await api.get('/sessions', { params });
  return data;
}

export async function updateSession(id: number, updates: any) {
  const { data } = await api.put(`/sessions/${id}`, updates);
  return data;
}

export async function endSession(id: number, extras?: { rpe?: number; mood?: number; notes?: string }) {
  const { data } = await api.put(`/sessions/${id}`, { ended_at: new Date().toISOString(), ...extras });
  return data;
}

export async function logSet(sessionId: number, payload: {
  exercise_id: number; set_number: number;
  reps?: number; weight?: number; duration_sec?: number; distance_m?: number;
  rpe?: number; completed?: boolean; notes?: string;
}) {
  const { data } = await api.post(`/sessions/${sessionId}/sets`, payload);
  return data;
}

export async function deleteSet(setId: number) {
  await api.delete(`/sessions/sets/${setId}`);
}

// --- Workouts: Symptom logs ---
export async function logSymptom(payload: {
  body_part: string; severity: number; notes?: string; session_id?: number;
}) {
  const { data } = await api.post('/symptoms', payload);
  return data;
}

export async function listSymptoms(params?: { body_part?: string; limit?: number }) {
  const { data } = await api.get('/symptoms', { params });
  return data;
}
