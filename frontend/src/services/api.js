import axios from 'axios';

// Base API configuration
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

export const api = {
  // Health
  getHealth: async () => {
    const res = await client.get('/health');
    return res.data;
  },

  // Dashboard stats
  getDashboardStats: async () => {
    const res = await client.get('/dashboard/stats');
    return res.data.data;
  },

  // Models
  getModels: async () => {
    const res = await client.get('/models');
    return res.data.data;
  },

  getModelById: async (id) => {
    const res = await client.get(`/models/${id}`);
    return res.data.data;
  },

  uploadModel: async (formData, onProgress) => {
    const res = await client.post('/models/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      },
    });
    return res.data;
  },

  deleteModel: async (id) => {
    const res = await client.delete(`/models/${id}`);
    return res.data;
  },

  getDownloadUrl: (id) => `${API_BASE}/models/${id}/download`,

  // Nodes
  getNodes: async () => {
    const res = await client.get('/nodes');
    return res.data.data;
  },

  pingNode: async (nodeId) => {
    const res = await client.post(`/nodes/${nodeId}/ping`);
    return res.data;
  },

  // Replicas
  getReplicas: async () => {
    const res = await client.get('/replicas');
    return res.data.data;
  },

  // Logs & Events
  getLogs: async (limit = 100) => {
    const res = await client.get(`/logs?limit=${limit}`);
    return res.data.data;
  },

  getEvents: async (limit = 50) => {
    const res = await client.get(`/events?limit=${limit}`);
    return res.data.data;
  },

  // Synchronization (Unit 3)
  getSyncStatus: async () => {
    const res = await client.get('/sync/status');
    return res.data.data;
  },

  getSyncTrace: async (limit = 200) => {
    const res = await client.get(`/sync/trace?limit=${limit}`);
    return res.data.data;
  },

  getClockRounds: async () => {
    const res = await client.get('/sync/clock-rounds');
    return res.data.data;
  },

  getSnapshots: async () => {
    const res = await client.get('/sync/snapshots');
    return res.data.data;
  },

  startElection: async (nodeId) => (await client.post('/sync/election', { nodeId })).data,
  runClockSync: async () => (await client.post('/sync/clock-sync')).data,
  injectSkew: async (nodeId, deltaMs) => (await client.post('/sync/skew', { nodeId, deltaMs })).data,
  requestMutex: async (nodeId) => (await client.post('/sync/mutex', { nodeId })).data,
  takeSnapshot: async (nodeId) => (await client.post('/sync/snapshot', { nodeId })).data,
};

// Utilities for formatting
export const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes === 0 || isNaN(bytes)) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
  return parseFloat((Number(bytes) / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const formatDate = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const truncateHash = (hash, len = 12) => {
  if (!hash) return '-';
  if (hash.length <= len * 2) return hash;
  return `${hash.substring(0, len)}...${hash.substring(hash.length - len)}`;
};
