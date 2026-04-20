import { create } from 'zustand';
import { Platform } from 'react-native';
import * as api from './api';
import { haptics } from './haptics';

// Lazy-load to avoid pulling the module into web module-eval — consistent
// with lib/api.ts, lib/pin.ts, lib/biometric.ts.
const SecureStore: typeof import('expo-secure-store') =
  Platform.OS === 'web' ? (null as any) : require('expo-secure-store');

// Web fallback for SecureStore (uses localStorage)
const tokenStorage = Platform.OS === 'web'
  ? {
      getItemAsync: async (key: string) => localStorage.getItem(key),
      setItemAsync: async (key: string, value: string) => { localStorage.setItem(key, value); },
      deleteItemAsync: async (key: string) => { localStorage.removeItem(key); },
    }
  : SecureStore;

// --- Auth Store ---
interface AuthState {
  token: string | null;
  user: { id: number; email: string; display_name: string | null } | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  loadToken: () => Promise<void>;
  setDisplayName: (name: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: true,

  loadToken: async () => {
    const token = await tokenStorage.getItemAsync('token');
    if (token) {
      set({ token });
      try {
        const user = await api.getMe();
        set({ user, isLoading: false });
      } catch (e: any) {
        // Only clear the token when the server actually rejected it.
        // Transient network / DNS / 5xx failures at cold-start should
        // leave the user signed in so a retry works without re-typing
        // their password.
        const status: number | undefined = e?.response?.status;
        if (status === 401 || status === 403) {
          await tokenStorage.deleteItemAsync('token');
          set({ token: null, user: null, isLoading: false });
        } else {
          set({ isLoading: false });
        }
      }
    } else {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const { access_token } = await api.login(email, password);
    await tokenStorage.setItemAsync('token', access_token);
    set({ token: access_token });
    const user = await api.getMe();
    set({ user });
  },

  register: async (email, password, displayName) => {
    const { access_token } = await api.register(email, password, displayName);
    await tokenStorage.setItemAsync('token', access_token);
    set({ token: access_token });
    const user = await api.getMe();
    set({ user });
  },

  logout: async () => {
    await tokenStorage.deleteItemAsync('token');
    set({ token: null, user: null });
  },

  // Update just the cached display_name after a successful PUT /auth/me
  // so the header / settings screen reflect the change without a reload.
  setDisplayName: (name: string | null) => set((s) => ({
    user: s.user ? { ...s.user, display_name: name } : s.user,
  })),
}));

// --- Folder Store ---
export interface SubfolderItem {
  id: number;
  folder_id: number;
  name: string;
  sort_order: number;
  task_count: number;
}

export interface Folder {
  id: number;
  name: string;
  sort_order: number;
  task_count: number;
  subfolders: SubfolderItem[];
}

interface FolderState {
  folders: Folder[];
  selectedFolderId: number | null;
  selectedSubfolderId: number | null;
  load: () => Promise<void>;
  selectFolder: (id: number | null) => void;
  selectSubfolder: (id: number | null) => void;
}

export const useFolderStore = create<FolderState>((set) => ({
  folders: [],
  selectedFolderId: null,
  selectedSubfolderId: null,

  load: async () => {
    const folders = await api.getFolders();
    set({ folders });
  },

  selectFolder: (id) => set({ selectedFolderId: id, selectedSubfolderId: null }),
  selectSubfolder: (id: number | null) => set({ selectedSubfolderId: id }),
}));

// --- Tag Store ---
export interface Tag {
  id: number;
  name: string;
}

interface TagState {
  tags: Tag[];
  load: () => Promise<void>;
}

export const useTagStore = create<TagState>((set) => ({
  tags: [],
  load: async () => {
    const tags = await api.getTags();
    set({ tags });
  },
}));

// --- Task Store ---
export interface Reminder {
  id: number;
  task_id: number;
  remind_at: string;
  reminded: boolean;
  created_at: string;
}

export interface Task {
  id: number;
  title: string;
  folder_id: number | null;
  folder_name: string | null;
  subfolder_id: number | null;
  subfolder_name: string | null;
  parent_id: number | null;
  note: string | null;
  priority: number;
  status: string;
  starred: boolean;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  repeat_type: string;
  repeat_from: string;
  sort_order: number;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  subtasks: Task[];
  reminders: Reminder[];
}

interface TaskState {
  tasks: Task[];
  total: number;
  page: number;
  isLoading: boolean;
  filters: api.TaskFilters;
  load: () => Promise<void>;
  setFilters: (f: Partial<api.TaskFilters>) => void;
  create: (task: api.TaskCreatePayload) => Promise<void>;
  update: (id: number, updates: api.TaskUpdatePayload) => Promise<void>;
  remove: (id: number) => Promise<void>;
  complete: (id: number) => Promise<void>;
  toggleStar: (id: number, starred: boolean) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  total: 0,
  page: 1,
  isLoading: false,
  filters: { completed: false, sort: 'folder', order: 'asc', per_page: 50 },

  load: async () => {
    set({ isLoading: true });
    try {
      const data = await api.getTasks(get().filters);
      set({ tasks: data.tasks, total: data.total, page: data.page });
    } finally {
      set({ isLoading: false });
    }
  },

  setFilters: (f) => {
    set((s) => ({ filters: { ...s.filters, ...f } }));
    get().load();
  },

  create: async (task) => {
    await api.createTask(task);
    get().load();
  },

  update: async (id, updates) => {
    await api.updateTask(id, updates);
    get().load();
  },

  remove: async (id) => {
    await api.deleteTask(id);
    get().load();
  },

  complete: async (id) => {
    await api.completeTask(id);
    haptics.success();
    get().load();
  },

  toggleStar: async (id, starred) => {
    await api.updateTask(id, { starred: !starred });
    get().load();
  },
}));

// --- Workouts ---
export interface ExerciseImage { id: number; url: string; caption?: string | null; sort_order: number; }
export interface Exercise {
  id: number; user_id: number | null; name: string; slug?: string;
  category: string; primary_muscle?: string; equipment?: string;
  difficulty: number; is_bodyweight: boolean; measurement: string;
  instructions?: string; cue?: string; contraindications?: string;
  images: ExerciseImage[];
}
export interface RoutineExercise {
  id: number; routine_id: number; exercise_id: number; sort_order: number;
  target_sets?: number; target_reps?: number; target_weight?: number;
  target_duration_sec?: number; rest_sec?: number; tempo?: string;
  keystone: boolean; notes?: string; exercise?: Exercise;
  /** Null = applies in every phase (warmups, cooldowns). Set = only surfaces
   *  when that phase is active. */
  phase_id?: number | null;
  /** Optimistic concurrency token — send back in expected_updated_at on save. */
  updated_at?: string | null;
}
export interface RoutinePhase {
  id: number; routine_id: number; label: string;
  order_idx: number; duration_weeks: number; notes?: string | null;
}
export interface Routine {
  id: number; user_id: number; name: string; goal: string;
  notes?: string; sort_order: number; created_at: string;
  reminder_time?: string | null;   // "HH:MM"
  reminder_days?: string | null;   // "mon,tue,..." or "daily"
  /** ISO date (YYYY-MM-DD) marking when phase 0 starts. Null = not phased
   *  and the routine behaves as a flat list. */
  phase_start_date?: string | null;
  /** Curovate-style progression phases, ordered by order_idx. Empty when
   *  the routine is flat. */
  phases?: RoutinePhase[];
  /** Server-resolved id of the phase active today (derived from
   *  phase_start_date + cumulative durations). Null when not phased. */
  current_phase_id?: number | null;
  /** When true, sessions started from this routine snapshot the flag and
   *  get pain-monitored progression + the per-set pain chip + symptom
   *  logger. Flipping it only affects *future* sessions; in-progress
   *  sessions keep the value they were started with. See PR #47. */
  tracks_symptoms?: boolean;
  /** Optimistic concurrency token — send back in expected_updated_at on save. */
  updated_at?: string | null;
  exercises: RoutineExercise[];
}
export interface SessionSet {
  id: number; session_id: number; exercise_id: number; set_number: number;
  reps?: number; weight?: number; duration_sec?: number; distance_m?: number;
  rpe?: number;
  /** Pain rating 0-10, nullable. Populated only when the parent session
   *  has tracks_symptoms=true (see PR #47). Strength sessions leave it
   *  undefined and the progression dispatcher falls through to RPE. */
  pain_score?: number | null;
  completed: boolean; notes?: string;
}
export interface WorkoutSession {
  id: number; user_id: number; routine_id: number | null;
  started_at: string; ended_at: string | null; rpe?: number;
  mood?: number; notes?: string;
  /** Session-time snapshot of the starting routine's tracks_symptoms.
   *  Gates pain UX throughout the session screen. See PR #47. */
  tracks_symptoms?: boolean;
  sets: SessionSet[];
}

interface WorkoutState {
  routines: Routine[];
  isLoading: boolean;
  loadRoutines: () => Promise<void>;
  removeRoutine: (id: number) => Promise<void>;
}

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  routines: [],
  isLoading: false,
  loadRoutines: async () => {
    set({ isLoading: true });
    try {
      const data = await api.getRoutines();
      set({ routines: data });
    } finally {
      set({ isLoading: false });
    }
  },
  removeRoutine: async (id) => {
    await api.deleteRoutine(id);
    get().loadRoutines();
  },
}));
