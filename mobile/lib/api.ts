import axios from 'axios';
import { Platform } from 'react-native';

// EXPO_PUBLIC_ env vars are inlined at build time by Metro. Override for
// production by setting EXPO_PUBLIC_API_URL in the host's build env
// (Vercel / EAS / .env.production).
//
// CRITICAL: Metro's static replace only fires on `process.env.EXPO_PUBLIC_*`
// literal dot access. Optional chaining (`process.env?.EXPO_PUBLIC_API_URL`)
// or `typeof process !== 'undefined'` guards short-circuit the transform,
// and on web `process` is undefined at runtime — so the fallback silently
// masks a misconfigured build. Keep the line exactly as written.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

// Fail loudly on the web when the production bundle was built without
// EXPO_PUBLIC_API_URL: otherwise the deployed site silently tries to talk
// to the visitor's own localhost. This is the #1 cause of "Vercel deploy
// looks fine but nothing works".
if (
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(BASE_URL) &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1'
) {
  // eslint-disable-next-line no-console
  console.error(
    '[TaskApp] EXPO_PUBLIC_API_URL was not set at build time; API calls ' +
      'will fail because they target http://localhost:8000. Set ' +
      'EXPO_PUBLIC_API_URL in your Vercel project env (Production + Preview) ' +
      'and redeploy.',
  );
}

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

export interface RoutineSuggestion {
  routine_exercise_id: number;
  exercise_id: number;
  reps?: number | null;
  weight?: number | null;
  duration_sec?: number | null;
  reason: string;
}

export async function exportWorkouts() {
  const { data } = await api.get('/export/workouts');
  return data;
}

export async function importWorkouts(payload: any, mode: 'merge' | 'replace' = 'merge', dryRun = false) {
  const { data } = await api.post('/import/workouts', { payload, mode, dry_run: dryRun });
  return data as {
    exercises_added: number; exercises_skipped: number;
    routines_added: number; routines_skipped: number;
    sessions_added: number; symptoms_added: number;
    warnings: string[]; dry_run: boolean;
  };
}

export async function getRoutineSuggestions(routineId: number) {
  const { data } = await api.get(`/routines/${routineId}/suggestions`);
  return data as RoutineSuggestion[];
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

export interface ImageCandidate {
  url: string;
  thumb?: string | null;
  source?: string | null;
  width?: number | null;
  height?: number | null;
}

export async function searchExerciseImages(exerciseId: number, q?: string, n = 6) {
  const { data } = await api.get(`/exercises/${exerciseId}/search-images`, {
    params: { q, n },
  });
  return data as ImageCandidate[];
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
  exercise_id: number;
  /** Omit to have the server auto-assign the next set_number atomically. */
  set_number?: number;
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
