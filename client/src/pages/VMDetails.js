import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import Navbar from '../components/Navbar';
import { Terminal as TerminalIcon, Activity, Monitor } from 'lucide-react';
import { toast } from 'react-toastify';
import TerminalComponent from '../components/Terminal';

const VMDetails = () => {
  const { id } = useParams();
  const [vm, setVm] = useState(null);
  const [logs, setLogs] = useState('');
  const [resources, setResources] = useState([]);
  const [activeTab, setActiveTab] = useState('terminal');

  useEffect(() => {
    fetchVM();
    const interval = setInterval(fetchVM, 10000); // Poll status
    return () => clearInterval(interval);
  }, [id]);

  const fetchResources = async () => {
    try {
      const response = await api.get(`/vms/${id}/resources?current=true`);
      if (response.data && response.data.length > 0) {
        const newData = response.data[0];
        setResources(prev => {
            // Если массив пустой, просто добавляем
            if (prev.length === 0) return [newData];
            // Простая проверка на дубликаты по времени
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

  useEffect(() => {
    let resourceInterval;
    if (activeTab === 'logs') fetchLogs();
    if (activeTab === 'resources') {
        fetchResources(); // Initial fetch
        resourceInterval = setInterval(fetchResources, 3000);
    }
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
              <div>
                <Monitor size={18} /> Terminal
              </div>
            </button>
            <button
              className={`vm-tab-button ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <div>
                <TerminalIcon size={18} /> Logs
              </div>
            </button>
            <button
              className={`vm-tab-button ${activeTab === 'resources' ? 'active' : ''}`}
              onClick={() => setActiveTab('resources')}
            >
              <div>
                <Activity size={18} /> Resources
              </div>
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
                {logs || 'No logs available yet...'}
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
                      {resources.map((log) => (
                        <tr key={log.id}>
                          <td>{new Date(log.timestamp).toLocaleString()}</td>
                          <td>{log.cpuUsage.toFixed(2)}%</td>
                          <td>{log.ramUsage.toFixed(2)}</td>
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default VMDetails;
