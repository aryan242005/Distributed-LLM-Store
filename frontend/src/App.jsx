import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Models from './pages/Models';
import ModelDetails from './pages/ModelDetails';
import UploadModel from './pages/UploadModel';
import StorageNodes from './pages/StorageNodes';
import Replication from './pages/Replication';
import Requests from './pages/Requests';
import Synchronization from './pages/Synchronization';

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleGlobalRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <Router>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
        <Navbar onRefresh={handleGlobalRefresh} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-6 md:p-8">
            <Routes>
              <Route path="/" element={<Dashboard key={refreshKey} />} />
              <Route path="/models" element={<Models key={refreshKey} />} />
              <Route path="/models/:id" element={<ModelDetails key={refreshKey} />} />
              <Route path="/upload" element={<UploadModel key={refreshKey} />} />
              <Route path="/nodes" element={<StorageNodes key={refreshKey} />} />
              <Route path="/replication" element={<Replication key={refreshKey} />} />
              <Route path="/requests" element={<Requests key={refreshKey} />} />
              <Route path="/sync" element={<Synchronization key={refreshKey} />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}
