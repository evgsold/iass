import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
// Assuming Navbar is used globally or in App.js, removed from local import if not needed here
// import Navbar from '../components/Navbar'; 
import { Terminal as TerminalIcon, Activity, Monitor, Save, Settings, RefreshCw, Server, Cpu, MemoryStick, HardDrive, AlertCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import TerminalComponent from '../components/Terminal';

const VMDetails = () => {
  const { id } = useParams();
  const [vm, setVm] = useState(null);
  const [logs, setLogs] = useState('');
  const [resources, setResources] = useState([]);
  const [backups, setBackups] = useState([]);
  const [activeTab, setActiveTab] = useState('terminal');
  const [loading, setLoading] = useState(false);
  
  // Resize State
  const [resizeConfig, setResizeConfig] = useState({ ram: 2048, cpu: 2 });

  useEffect(() => {
    fetchVM();
    const interval = setInterval(fetchVM, 10000); // Poll status
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (vm) {
        setResizeConfig({ ram: vm.ram, cpu: vm.cpu });
    }
  }, [vm]);

  const fetchResources = async () => {
    try {
      const response = await api.get(`/vms/${id}/resources?current=true`);
      if (response.data && response.data.length > 0) {
        const newData = response.data[0];
        setResources(prev => {
            if (prev.length === 0) return [newData];
            if (new Date(prev[0].timestamp).getTime() === new Date(newData.timestamp).getTime()) {
                return prev;
            }
            return [newData, ...prev].slice(0, 20);
        });
      }
    } catch (error) {
      console.error('Failed to fetch resources');
    }
  };

  const fetchBackups = async () => {
      try {
          const response = await api.get(`/vms/${id}/backups`);
          setBackups(response.data);
      } catch (error) {
          toast.error('Failed to fetch backups');
      }
  };

  useEffect(() => {
    let resourceInterval;
    if (activeTab === 'logs') fetchLogs();
    if (activeTab === 'resources') {
        fetchResources();
        resourceInterval = setInterval(fetchResources, 3000);
    }
    if (activeTab === 'backups') fetchBackups();

    return () => {
        if (resourceInterval) clearInterval(resourceInterval);
    };
  }, [activeTab, id]);

  const fetchVM = async () => {
    try {
      const response = await api.get(`/vms/${id}`);
      setVm(response.data);
    } catch (error) {
      console.error('Failed to fetch VM');
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await api.get(`/vms/${id}/logs`);
      setLogs(response.data.logs);
    } catch (error) {
      console.error('Failed to fetch logs');
    }
  };

  const handleCreateBackup = async () => {
      const name = prompt('Enter backup name:');
      if (!name) return;

      setLoading(true);
      try {
          await api.post(`/vms/${id}/backups`, { name });
          toast.success('Backup started');
          fetchBackups();
      } catch (error) {
          toast.error(error.response?.data?.error || 'Backup failed');
      } finally {
          setLoading(false);
      }
  };

  const handleRestoreBackup = async (backupId) => {
      if (!window.confirm('Are you sure? This will replace the current container state.')) return;
      
      setLoading(true);
      try {
          await api.post(`/vms/${id}/restore/${backupId}`);
          toast.success('Restore started');
          fetchVM();
      } catch (error) {
          toast.error(error.response?.data?.error || 'Restore failed');
      } finally {
          setLoading(false);
      }
  };

  const handleResize = async () => {
      setLoading(true);
      try {
          await api.post(`/vms/${id}/resize`, resizeConfig);
          toast.success('Resources updated successfully');
          fetchVM();
      } catch (error) {
          toast.error(error.response?.data?.error || 'Resize failed');
      } finally {
          setLoading(false);
      }
  };

  if (!vm) return <div className="loading-state">Loading VM details...</div>;

  return (
    <div style={{ background: '#f9fafb', minHeight: '100vh', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* --- Header Section --- */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: '700', color: '#111827', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {vm.name}
                <span className={`status-badge ${
                  vm.status === 'running' || vm.status === 'deployed' ? 'status-running' : 
                  vm.status === 'error' ? 'status-error' : 'status-default'
                }`} style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                  {vm.status}
                </span>
              </h1>
              <div style={{ display: 'flex', gap: '20px', color: '#6b7280', fontSize: '0.95rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Server size={16} /> {vm.type === 'app' ? `${vm.framework} App` : (vm.type === 'docker' ? 'Docker Container' : 'Kubernetes')}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Monitor size={16} /> {vm.ip || 'No IP Assigned'}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MemoryStick size={16} /> {vm.ram} MB RAM</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Cpu size={16} /> {vm.cpu} vCPU</span>
              </div>
            </div>
            {/* Optional: Add Action Buttons here like Restart/Delete if needed */}
          </div>

          {vm.error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
              <AlertCircle size={20} />
              <span>{vm.error}</span>
            </div>
          )}
        </div>

        {/* --- Main Content Card --- */}
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          
          {/* Tabs Navigation */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
            {[
              { id: 'terminal', label: 'Console', icon: <TerminalIcon size={18} /> },
              { id: 'logs', label: 'Logs', icon: <Activity size={18} /> },
              { id: 'resources', label: 'Metrics', icon: <Monitor size={18} /> },
              { id: 'backups', label: 'Backups', icon: <Save size={18} /> },
              { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '1rem 1.5rem',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  fontWeight: activeTab === tab.id ? '600' : '500',
                  color: activeTab === tab.id ? '#0069ff' : '#6b7280',
                  borderBottom: activeTab === tab.id ? '2px solid #0069ff' : '2px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s'
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content Area */}
          <div style={{ padding: '2rem', minHeight: '400px' }}>
            
            {/* TERMINAL TAB */}
            {activeTab === 'terminal' && (
              <div style={{ height: '600px', background: '#1e1e1e', borderRadius: '6px', overflow: 'hidden' }}>
                <TerminalComponent vmId={id} />
              </div>
            )}

            {/* LOGS TAB */}
            {activeTab === 'logs' && (
              <div style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '1.5rem', borderRadius: '6px', height: '600px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{logs || 'Waiting for logs...'}</pre>
              </div>
            )}

            {/* RESOURCES TAB */}
            {activeTab === 'resources' && (
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1.5rem', color: '#111827' }}>Resource Usage History</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ padding: '12px', color: '#6b7280', fontWeight: '600' }}>Timestamp</th>
                        <th style={{ padding: '12px', color: '#6b7280', fontWeight: '600' }}>CPU Usage</th>
                        <th style={{ padding: '12px', color: '#6b7280', fontWeight: '600' }}>RAM Usage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resources.map((log, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '12px', color: '#374151' }}>{new Date(log.timestamp).toLocaleString()}</td>
                          <td style={{ padding: '12px', color: '#374151' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '100px', height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(log.cpuUsage, 100)}%`, height: '100%', background: '#0069ff' }}></div>
                              </div>
                              {log.cpuUsage?.toFixed(1)}%
                            </div>
                          </td>
                          <td style={{ padding: '12px', color: '#374151' }}>
                             <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '100px', height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min((log.ramUsage / vm.ram) * 100, 100)}%`, height: '100%', background: '#10b981' }}></div>
                              </div>
                              {log.ramUsage?.toFixed(0)} MB
                            </div>
                          </td>
                        </tr>
                      ))}
                      {resources.length === 0 && (
                        <tr>
                          <td colSpan="3" style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>No resource data available yet</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* BACKUPS TAB */}
            {activeTab === 'backups' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#111827', margin: 0 }}>Container Backups</h3>
                  <button 
                    onClick={handleCreateBackup} 
                    disabled={loading}
                    style={{ background: '#0069ff', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '6px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
                  >
                    {loading ? 'Creating...' : 'Create Backup'}
                  </button>
                </div>
                
                {backups.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', background: '#f9fafb', borderRadius: '6px', border: '1px dashed #d1d5db' }}>
                    <Save size={40} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
                    <p>No backups found for this resource.</p>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ padding: '12px', color: '#6b7280', fontWeight: '600' }}>Name</th>
                        <th style={{ padding: '12px', color: '#6b7280', fontWeight: '600' }}>Created At</th>
                        <th style={{ padding: '12px', color: '#6b7280', fontWeight: '600' }}>Status</th>
                        <th style={{ padding: '12px', color: '#6b7280', fontWeight: '600' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map(backup => (
                        <tr key={backup.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '12px', fontWeight: '500', color: '#111827' }}>{backup.name}</td>
                          <td style={{ padding: '12px', color: '#6b7280' }}>{new Date(backup.createdAt).toLocaleString()}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ 
                              padding: '4px 8px', 
                              borderRadius: '4px', 
                              fontSize: '0.8rem', 
                              fontWeight: '600',
                              background: backup.status === 'ready' ? '#d1fae5' : '#fee2e2',
                              color: backup.status === 'ready' ? '#065f46' : '#991b1b'
                            }}>
                              {backup.status}
                            </span>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <button 
                              onClick={() => handleRestoreBackup(backup.id)}
                              disabled={loading || backup.status !== 'ready'}
                              style={{ 
                                background: 'white', 
                                border: '1px solid #d1d5db', 
                                color: '#374151', 
                                padding: '6px 12px', 
                                borderRadius: '4px', 
                                fontSize: '0.85rem', 
                                cursor: (loading || backup.status !== 'ready') ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}
                            >
                              <RefreshCw size={14} /> Restore
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* SETTINGS TAB */}
            {activeTab === 'settings' && (
              <div style={{ maxWidth: '600px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#111827', marginBottom: '1.5rem' }}>Resize Resources</h3>
                
                <div style={{ background: '#f9fafb', padding: '1.5rem', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', color: '#374151', fontSize: '0.9rem' }}>RAM (MB)</label>
                    <input 
                      type="number" 
                      value={resizeConfig.ram}
                      onChange={(e) => setResizeConfig({...resizeConfig, ram: parseInt(e.target.value)})}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem' }}
                    />
                  </div>
                  
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', color: '#374151', fontSize: '0.9rem' }}>CPU (Cores)</label>
                    <input 
                      type="number" 
                      value={resizeConfig.cpu}
                      onChange={(e) => setResizeConfig({...resizeConfig, cpu: parseInt(e.target.value)})}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem' }}
                    />
                  </div>

                  <button 
                    onClick={handleResize} 
                    disabled={loading}
                    style={{ 
                      background: '#0069ff', 
                      color: 'white', 
                      border: 'none', 
                      padding: '0.75rem 1.5rem', 
                      borderRadius: '6px', 
                      fontWeight: '600', 
                      cursor: loading ? 'not-allowed' : 'pointer',
                      width: '100%'
                    }}
                  >
                    {loading ? 'Updating Resources...' : 'Apply Changes'}
                  </button>
                  
                  <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#6b7280', lineHeight: '1.5' }}>
                    <strong>Note:</strong> Increasing resources is usually applied immediately. Decreasing resources might require a container restart.
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
      
      {/* Global Styles for Status Badges (Injecting via style tag for simplicity) */}
      <style>{`
        .status-running { background-color: #dcfce7; color: #166534; }
        .status-error { background-color: #fee2e2; color: #991b1b; }
        .status-default { background-color: #f3f4f6; color: #4b5563; }
        .loading-state { display: flex; justify-content: center; align-items: center; height: 100vh; color: #6b7280; font-size: 1.2rem; }
      `}</style>
    </div>
  );
};

export default VMDetails;