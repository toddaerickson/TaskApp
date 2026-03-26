import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Change this to your deployed backend URL
const BASE_URL = __DEV__
  ? 'http://localhost:8000'
  : 'https://your-backend.railway.app';

const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
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
  status?: string;
  priority?: number;
  tag?: string;
  starred?: boolean;
  completed?: boolean;
  search?: string;
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

export async function batchUpdate(taskIds: number[], updates: any) {
  const { data } = await api.post('/tasks/batch', { task_ids: taskIds, ...updates });
  return data;
}
