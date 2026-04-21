import axios from 'axios';
import axiosRetry from 'axios-retry';
import { Platform } from 'react-native';
import { emitSessionExpired } from './sessionExpiry';
import { newRequestId } from './requestId';
import { reportError } from './errorReporter';

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

// Retry flaky GETs only. Writes (POST/PUT/DELETE/PATCH) are intentionally
// NOT retried: a dropped connection after the server accepted a mutation
// would double-post on retry. The default `isNetworkOrIdempotentRequestError`
// already covers network errors + 5xx; we tighten it to GET only so we
// don't retry idempotent writes either.
axiosRetry(api, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    const method = (error.config?.method ?? '').toLowerCase();
    if (method !== 'get') return false;
    return axiosRetry.isNetworkOrIdempotentRequestError(error);
  },
});

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
  // Tag every request with a short id so a failed call can be paired with
  // the server log line. axios-retry reuses config on retry, so the id is
  // stable across attempts — making "did retry #3 succeed?" answerable.
  if (!config.headers['X-Request-Id']) {
    config.headers['X-Request-Id'] = newRequestId();
  }
  return config;
});

// Active-use extends the PIN unlock window. Any successful authed API
// call calls touchUnlock() so a user who's continuously interacting
// doesn't get kicked to PinGate mid-session when the 8-hour window
// expires. The re-lock on AppState foreground transition (see
// _layout.tsx) still catches a real "walked away and came back" case.
//
// Deliberately fire-and-forget: we don't want response delivery to
// wait on a SecureStore write. Also skip on /auth/* endpoints so a
// failed login doesn't refresh a window the user no longer has.
function maybeTouchUnlock(url: string) {
  if (url.includes('/auth/login') || url.includes('/auth/register')) return;
  // Lazy require so the module stays tree-shakeable. Platform-safe.
  // Swallow errors: the worst case is that the user re-enters their
  // PIN eight hours from now, not nine.
  try {
    const pin = require('./pin');
    pin.touchUnlock?.().catch(() => { /* noop */ });
  } catch {
    /* noop */
  }
}

// Global 401 handler. If the server rejects a request that carried an
// Authorization header, the stored token is dead — clear it and let the
// UI layer (subscribed via sessionExpiry) show a modal + route to /login.
// 401s on /auth/login itself are expected (wrong password) — skip those
// so we don't trigger the expired-session flow on a fresh login attempt.
api.interceptors.response.use(
  (response) => {
    const url: string = response?.config?.url || '';
    const hadAuth = Boolean(response?.config?.headers?.Authorization);
    if (hadAuth) maybeTouchUnlock(url);
    return response;
  },
  async (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url || '';
    const hadAuth = Boolean(error?.config?.headers?.Authorization);
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
    if (status === 401 && hadAuth && !isAuthEndpoint) {
      try {
        if (Platform.OS === 'web') {
          localStorage.removeItem('token');
        } else {
          const SecureStore = require('expo-secure-store');
          await SecureStore.deleteItemAsync('token');
        }
      } catch { /* best-effort cleanup */ }
      emitSessionExpired();
    }
    // Telemetry: only 5xx and network errors are worth forwarding. 4xx
    // tends to be user-input driven (409 conflicts, 422 validation) and
    // would create noise. requestId is echoed by the server via the
    // X-Request-Id header on the response; pair it with the Sentry event.
    const isServerOrNetwork = !status || status >= 500;
    if (isServerOrNetwork && !isAuthEndpoint) {
      const rid =
        (error?.response?.headers?.['x-request-id'] as string | undefined) ||
        (error?.config?.headers?.['X-Request-Id'] as string | undefined);
      reportError(error, {
        requestId: rid,
        status,
        route: url,
        tags: { method: (error?.config?.method || 'get').toUpperCase() },
      });
    }
    return Promise.reject(error);
  },
);

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

export async function changePassword(currentPassword: string, newPassword: string) {
  const { data } = await api.post('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
  return data;
}

export async function updateProfile(patch: { display_name?: string | null }) {
  const { data } = await api.put('/auth/me', patch);
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

export async function updateFolder(id: number, patch: { name?: string; sort_order?: number }) {
  const { data } = await api.put(`/folders/${id}`, patch);
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

/** POST /tasks body. Matches backend Pydantic TaskCreate. */
export interface TaskCreatePayload {
  title: string;
  folder_id?: number | null;
  subfolder_id?: number | null;
  parent_id?: number | null;
  note?: string | null;
  priority?: number;
  status?: string;
  starred?: boolean;
  /** YYYY-MM-DD */
  start_date?: string | null;
  /** YYYY-MM-DD */
  due_date?: string | null;
  /** HH:MM */
  due_time?: string | null;
  repeat_type?: string;
  repeat_from?: string;
  sort_order?: number;
  tag_ids?: number[];
}

/** PUT /tasks/{id} body. Same shape as TaskCreatePayload but everything optional. */
export type TaskUpdatePayload = Partial<TaskCreatePayload>;

/** POST /tasks/batch extras (task_ids is supplied separately). */
export interface TaskBatchUpdatePayload {
  folder_id?: number | null;
  subfolder_id?: number | null;
  priority?: number;
  status?: string;
  starred?: boolean;
  completed?: boolean;
}

export async function getTasks(filters: TaskFilters = {}) {
  const { data } = await api.get('/tasks', { params: filters });
  return data;
}

export async function getTask(id: number) {
  const { data } = await api.get(`/tasks/${id}`);
  return data;
}

export async function createTask(task: TaskCreatePayload) {
  const { data } = await api.post('/tasks', task);
  return data;
}

export async function updateTask(id: number, updates: TaskUpdatePayload) {
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

export async function batchUpdate(taskIds: number[], updates: TaskBatchUpdatePayload) {
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
export async function getExercises(
  params?: { category?: string; search?: string; include_archived?: boolean },
) {
  const { data } = await api.get('/exercises', { params });
  return data;
}

export async function getExercise(id: number) {
  const { data } = await api.get(`/exercises/${id}`);
  return data;
}

export interface ExerciseCreatePayload {
  name: string;
  slug?: string | null;
  category?: string;
  primary_muscle?: string | null;
  equipment?: string | null;
  difficulty?: number;
  is_bodyweight?: boolean;
  measurement?: string;
  instructions?: string | null;
  cue?: string | null;
  contraindications?: string | null;
  min_age?: number | null;
  max_age?: number | null;
}
export type ExerciseUpdatePayload = Partial<Omit<ExerciseCreatePayload, 'slug'>>;

/** Individual exercise slot when creating or appending to a routine.
 * All optional numeric fields accept `null` to clear server-side. */
export interface RoutineExerciseCreatePayload {
  exercise_id: number;
  sort_order?: number;
  target_sets?: number | null;
  target_reps?: number | null;
  target_weight?: number | null;
  target_duration_sec?: number | null;
  rest_sec?: number | null;
  tempo?: string | null;
  keystone?: boolean;
  notes?: string | null;
  /** null = "all phases" (every phase the routine has). Server-side
   *  default for rows created before the phase editor shipped. */
  phase_id?: number | null;
  /** Target RPE per working set, 1-10. Null clears. Server enforces
   *  the 1-10 bound via Pydantic Field(ge=1, le=10). */
  target_rpe?: number | null;
}
export type RoutineExerciseUpdatePayload = Partial<Omit<RoutineExerciseCreatePayload, 'exercise_id'>> & {
  /** Same optimistic-concurrency story as RoutineUpdatePayload. */
  expected_updated_at?: string;
};

export interface RoutineCreatePayload {
  name: string;
  goal?: string;
  notes?: string | null;
  sort_order?: number;
  reminder_time?: string | null;
  reminder_days?: string | null;
  /** When true, new sessions snapshot the flag at POST time and render
   *  the symptom logger + per-set pain chip + pain-monitored progression.
   *  Default false keeps strength routines untouched. */
  tracks_symptoms?: boolean;
  exercises?: RoutineExerciseCreatePayload[];
}
export type RoutineUpdatePayload = Partial<Omit<RoutineCreatePayload, 'exercises'>> & {
  /** ISO date "YYYY-MM-DD". Sets phase 0's start date so the server can
   *  resolve current_phase_id. Send null to un-phase. */
  phase_start_date?: string | null;
  /** Optimistic concurrency: ISO timestamp of the routine when the client
   *  last read it. Server returns 409 if the row has moved past it. Omit
   *  to opt out (silent last-write-wins). */
  expected_updated_at?: string;
};

export interface SessionUpdatePayload {
  ended_at?: string | null;
  rpe?: number;
  mood?: number;
  notes?: string | null;
}

export async function createExercise(payload: ExerciseCreatePayload) {
  const { data } = await api.post('/exercises', payload);
  return data;
}

export async function updateExercise(id: number, updates: ExerciseUpdatePayload) {
  const { data } = await api.put(`/exercises/${id}`, updates);
  return data;
}

export async function deleteExercise(id: number) {
  // Server-side soft-delete: sets archived_at on the row. The exercise
  // disappears from default list responses but routines / sessions
  // that reference it still resolve.
  await api.delete(`/exercises/${id}`);
}

export async function restoreExercise(id: number) {
  const { data } = await api.post(`/exercises/${id}/restore`);
  return data;
}

export async function updateRoutine(id: number, updates: RoutineUpdatePayload) {
  const { data } = await api.put(`/routines/${id}`, updates);
  return data;
}

export async function updateRoutineExercise(routineExerciseId: number, updates: RoutineExerciseUpdatePayload) {
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

export async function importWorkouts(payload: unknown, mode: 'merge' | 'replace' = 'merge', dryRun = false) {
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
  // Backend caps each page at `limit` (default 50, max 200) with cursor-based
  // pagination on `(sort_order, id)`. Loop until a short page comes back so
  // callers never silently lose rows past the first page — this codebase has
  // no "load more" UI yet and almost every screen treats the list as total.
  const PAGE = 200;
  const all: any[] = [];
  let cursor: number | undefined;
  for (let i = 0; i < 20; i++) {
    const { data } = await api.get('/routines', {
      params: cursor === undefined ? { limit: PAGE } : { limit: PAGE, cursor },
    });
    all.push(...data);
    if (data.length < PAGE) break;
    cursor = data[data.length - 1].id;
  }
  return all;
}

export async function getRoutine(id: number) {
  const { data } = await api.get(`/routines/${id}`);
  return data;
}

export async function createRoutine(payload: RoutineCreatePayload) {
  const { data } = await api.post('/routines', payload);
  return data;
}

/** Import a routine from the portable JSON template. Server validates
 *  slugs, phase_idx ranges, and measurement compatibility — same checks
 *  the client runs in routineImport.parseAndValidate, but trustworthy
 *  even if the client was bypassed. */
export async function importRoutine(payload: unknown) {
  const { data } = await api.post('/routines/import', payload);
  return data;
}

export async function deleteRoutine(id: number) {
  await api.delete(`/routines/${id}`);
}

/** Deep-copy a routine into a fresh template. Returns the full hydrated
 *  new routine so the caller can navigate directly into it. Name gets a
 *  " (copy)" suffix server-side — clients don't prompt for a name, the
 *  user renames inline in the detail screen if desired. Return type
 *  stays inferred (untyped from the server) so we don't duplicate the
 *  Routine shape that lives in lib/stores.ts. */
export async function cloneRoutine(id: number) {
  const { data } = await api.post(`/routines/${id}/clone`);
  return data;
}

export async function addExerciseToRoutine(routineId: number, payload: RoutineExerciseCreatePayload) {
  const { data } = await api.post(`/routines/${routineId}/exercises`, payload);
  return data;
}

export async function removeExerciseFromRoutine(routineExerciseId: number) {
  await api.delete(`/routines/exercises/${routineExerciseId}`);
}

// ---- Phases (Curovate-style progression) ----------------------------------
// A routine with zero phases behaves as it always has. Creating phases
// doesn't flip the routine into "phased mode" until `phase_start_date`
// is set via updateRoutine(id, { phase_start_date: "YYYY-MM-DD" }).

export interface RoutinePhasePayload {
  label: string;
  order_idx: number;
  duration_weeks: number;
  notes?: string | null;
}
export type RoutinePhaseUpdatePayload = Partial<RoutinePhasePayload>;

export async function createPhase(routineId: number, payload: RoutinePhasePayload) {
  const { data } = await api.post(`/routines/${routineId}/phases`, payload);
  return data;
}

export async function updatePhase(
  routineId: number, phaseId: number, payload: RoutinePhaseUpdatePayload,
) {
  const { data } = await api.put(`/routines/${routineId}/phases/${phaseId}`, payload);
  return data;
}

export async function deletePhase(routineId: number, phaseId: number) {
  await api.delete(`/routines/${routineId}/phases/${phaseId}`);
}

export async function reorderPhases(routineId: number, phaseIds: number[]) {
  const { data } = await api.post(
    `/routines/${routineId}/phases/reorder`, { phase_ids: phaseIds },
  );
  return data;
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

export async function listSessions(params?: { limit?: number; cursor?: number; routine_id?: number }) {
  const { data } = await api.get('/sessions', { params });
  return data;
}

export async function updateSession(id: number, updates: SessionUpdatePayload) {
  const { data } = await api.put(`/sessions/${id}`, updates);
  return data;
}

export async function endSession(id: number, extras?: { rpe?: number; mood?: number; notes?: string }) {
  const { data } = await api.put(`/sessions/${id}`, { ended_at: new Date().toISOString(), ...extras });
  return data;
}

export interface SessionExerciseBest {
  exercise_id: number;
  max_weight: number | null;
  max_reps: number | null;
  max_duration_sec: number | null;
}

export async function getSessionPRs(sessionId: number) {
  const { data } = await api.get(`/sessions/${sessionId}/prs`);
  return data as SessionExerciseBest[];
}

export async function logSet(sessionId: number, payload: {
  exercise_id: number;
  /** Omit to have the server auto-assign the next set_number atomically. */
  set_number?: number;
  reps?: number; weight?: number; duration_sec?: number; distance_m?: number;
  rpe?: number; pain_score?: number; completed?: boolean; notes?: string;
  /** 'left' | 'right' | undefined (bilateral). The server normalizes any
   *  other value to NULL so old clients can't punch in a bogus side. */
  side?: 'left' | 'right';
  /** Warmup sets are excluded from volume + progression suggestion. */
  is_warmup?: boolean;
}) {
  const { data } = await api.post(`/sessions/${sessionId}/sets`, payload);
  return data;
}

/**
 * Backfill / correct a previously-logged set. Used by the tap-row-to-edit
 * sheet when the user fixes a mis-typed rep/weight, and by the pain chip
 * for post-hoc pain_score. Structural fields (set_number, session_id,
 * exercise_id) are not in the server's allow-list so sending them is a
 * no-op — omit from the payload for clarity. Pass null to clear a field.
 */
export async function patchSet(setId: number, payload: {
  reps?: number | null;
  weight?: number | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  rpe?: number | null;
  pain_score?: number | null;
  notes?: string | null;
}) {
  const { data } = await api.patch(`/sessions/sets/${setId}`, payload);
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

export async function updateSymptom(
  id: number,
  patch: { body_part?: string; severity?: number; notes?: string | null },
) {
  const { data } = await api.patch(`/symptoms/${id}`, patch);
  return data;
}

export async function deleteSymptom(id: number) {
  await api.delete(`/symptoms/${id}`);
}
