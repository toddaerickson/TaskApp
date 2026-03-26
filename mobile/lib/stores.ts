import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as api from './api';

// --- Auth Store ---
interface AuthState {
  token: string | null;
  user: { id: number; email: string; display_name: string | null } | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  loadToken: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: true,

  loadToken: async () => {
    const token = await SecureStore.getItemAsync('token');
    if (token) {
      set({ token });
      try {
        const user = await api.getMe();
        set({ user, isLoading: false });
      } catch {
        await SecureStore.deleteItemAsync('token');
        set({ token: null, user: null, isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const { access_token } = await api.login(email, password);
    await SecureStore.setItemAsync('token', access_token);
    set({ token: access_token });
    const user = await api.getMe();
    set({ user });
  },

  register: async (email, password, displayName) => {
    const { access_token } = await api.register(email, password, displayName);
    await SecureStore.setItemAsync('token', access_token);
    set({ token: access_token });
    const user = await api.getMe();
    set({ user });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('token');
    set({ token: null, user: null });
  },
}));

// --- Folder Store ---
interface Folder {
  id: number;
  name: string;
  sort_order: number;
  task_count: number;
}

interface FolderState {
  folders: Folder[];
  selectedFolderId: number | null;
  load: () => Promise<void>;
  selectFolder: (id: number | null) => void;
}

export const useFolderStore = create<FolderState>((set) => ({
  folders: [],
  selectedFolderId: null,

  load: async () => {
    const folders = await api.getFolders();
    set({ folders });
  },

  selectFolder: (id) => set({ selectedFolderId: id }),
}));

// --- Tag Store ---
interface Tag {
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
export interface Task {
  id: number;
  title: string;
  folder_id: number | null;
  folder_name: string | null;
  note: string | null;
  priority: number;
  status: string;
  starred: boolean;
  due_date: string | null;
  due_time: string | null;
  repeat_type: string;
  repeat_from: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

interface TaskState {
  tasks: Task[];
  total: number;
  page: number;
  isLoading: boolean;
  filters: api.TaskFilters;
  load: () => Promise<void>;
  setFilters: (f: Partial<api.TaskFilters>) => void;
  create: (task: any) => Promise<void>;
  update: (id: number, updates: any) => Promise<void>;
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
    get().load();
  },

  toggleStar: async (id, starred) => {
    await api.updateTask(id, { starred: !starred });
    get().load();
  },
}));
