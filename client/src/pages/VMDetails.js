import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import Navbar from '../components/Navbar';
import { Terminal as TerminalIcon, Activity, Monitor, Save, Settings, RefreshCw } from 'lucide-react';
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

  if (!vm) return <div>Loading...</div>;

  return (
    <div className="vm-details-page">
      <div className="container page-content">
        <div className="vm-details-card">
          <h1 className="vm-details-title">{vm.name}</h1>
          <div className="vm-details-meta">
            <span>Status: <strong>{vm.status}</strong></span>
            <span>Type: <strong>{vm.type || 'app'}</strong></span>
            {vm.type === 'app' && <span>Framework: <strong>{vm.framework || 'node'}</strong></span>}
            {vm.type === 'docker' && <span>Image: <strong>{vm.dockerImage}</strong></span>}
            <span>IP: {vm.ip || 'N/A'}</span>
            <span>RAM: {vm.ram}MB</span>
            <span>CPU: {vm.cpu} Cores</span>
          </div>
          {vm.error && (
            <div className="vm-error-message">
              Error: {vm.error}
            </div>
          )}
        </div>

        <div className="vm-tabs-card">
          <div className="vm-tabs-header">
            <button
              className={`vm-tab-button ${activeTab === 'terminal' ? 'active' : ''}`}
              onClick={() => setActiveTab('terminal')}
            >
              <Monitor size={18} /> Terminal
            </button>
            <button
              className={`vm-tab-button ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <TerminalIcon size={18} /> Logs
            </button>
            <button
              className={`vm-tab-button ${activeTab === 'resources' ? 'active' : ''}`}
              onClick={() => setActiveTab('resources')}
            >
              <Activity size={18} /> Resources
            </button>
            <button
              className={`vm-tab-button ${activeTab === 'backups' ? 'active' : ''}`}
              onClick={() => setActiveTab('backups')}
            >
              <Save size={18} /> Backups
            </button>
            <button
              className={`vm-tab-button ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={18} /> Settings
            </button>
          </div>

          <div className="vm-tab-content">
            {activeTab === 'terminal' && (
              <div className="vm-terminal-container">
                <TerminalComponent vmId={id} />
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="vm-logs-display">
                <pre>{logs || 'No logs available yet...'}</pre>
              </div>
            )}

            {activeTab === 'resources' && (
              <div className="vm-resources-history">
                <h3 className="section-title">Resource Usage History</h3>
                <div className="vm-resources-table-container">
                  <table className="vm-resources-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>CPU Usage (%)</th>
                        <th>RAM Usage (MB)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resources.map((log, i) => (
                        <tr key={i}>
                          <td>{new Date(log.timestamp).toLocaleString()}</td>
                          <td>{log.cpuUsage?.toFixed(2)}%</td>
                          <td>{log.ramUsage?.toFixed(2)}</td>
                        </tr>
                      ))}
                      {resources.length === 0 && (
                        <tr>
                          <td colSpan="3" className="no-resource-data">No resource data available</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'backups' && (
                <div className="vm-backups-container">
                    <div className="vm-backups-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3>Container Backups</h3>
                        <button className="btn btn-primary" onClick={handleCreateBackup} disabled={loading}>
                            {loading ? 'Creating...' : 'Create Backup'}
                        </button>
                    </div>
                    <div className="vm-backups-list">
                        {backups.length === 0 ? (
                            <p>No backups found.</p>
                        ) : (
                            <table className="vm-resources-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Created At</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {backups.map(backup => (
                                        <tr key={backup.id}>
                                            <td>{backup.name}</td>
                                            <td>{new Date(backup.createdAt).toLocaleString()}</td>
                                            <td>{backup.status}</td>
                                            <td>
                                                <button 
                                                    className="btn btn-small btn-secondary" 
                                                    onClick={() => handleRestoreBackup(backup.id)}
                                                    disabled={loading || backup.status !== 'ready'}
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
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="vm-settings-container">
                    <h3>Resize Resources</h3>
                    <div className="form-group">
                        <label>RAM (MB)</label>
                        <input 
                            type="number" 
                            className="form-control"
                            value={resizeConfig.ram}
                            onChange={(e) => setResizeConfig({...resizeConfig, ram: parseInt(e.target.value)})}
                        />
                    </div>
                    <div className="form-group">
                        <label>CPU (Cores)</label>
                        <input 
                            type="number" 
                            className="form-control"
                            value={resizeConfig.cpu}
                            onChange={(e) => setResizeConfig({...resizeConfig, cpu: parseInt(e.target.value)})}
                        />
                    </div>
                    <button className="btn btn-primary" onClick={handleResize} disabled={loading}>
                        {loading ? 'Updating...' : 'Apply & Resize'}
                    </button>
                    <p className="text-muted" style={{ marginTop: '10px', fontSize: '0.9em' }}>
                        Note: Increasing resources is usually applied immediately. Decreasing might require a restart.
                    </p>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VMDetails;
