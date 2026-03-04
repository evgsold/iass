import React, { useState, useEffect } from 'react';
import api from '../api';
import { Server, Cpu, HardDrive, Activity } from 'lucide-react';
import { toast } from 'react-toastify';

const AdminDashboard = () => {
  const [stats, setStats] = useState({ allocated: {}, total: {}, vmsCount: 0 });
  const [vms, setVms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, vmsRes] = await Promise.all([
        api.get('/admin/resources'),
        api.get('/admin/vms')
      ]);
      setStats(statsRes.data);
      setVms(vmsRes.data);
    } catch (error) {
      toast.error('Failed to fetch admin data');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-8 text-center" style={{ padding: '2rem', textAlign: 'center' }}>Loading admin dashboard...</div>;

  return (
    <div className="dashboard-content">
      <h1 className="dashboard-title" style={{ marginBottom: '1.5rem' }}>Admin Dashboard</h1>

      {/* Stats Cards */}
      <div className="admin-stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <h3 className="stat-title">Total VMs</h3>
            <Server className="text-blue-500" size={20} style={{ color: '#3b82f6' }} />
          </div>
          <p className="stat-value">{stats.vmsCount}</p>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <h3 className="stat-title">Allocated CPU</h3>
            <Cpu className="text-purple-500" size={20} style={{ color: '#a855f7' }} />
          </div>
          <p className="stat-value">{stats.allocated.cpu} Cores</p>
          <p className="stat-subtitle">Total Available: {stats.total.cpu || 'N/A'}</p>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <h3 className="stat-title">Allocated RAM</h3>
            <Activity className="text-green-500" size={20} style={{ color: '#10b981' }} />
          </div>
          <p className="stat-value">{Math.round(stats.allocated.ram / 1024)} GB</p>
           <p className="stat-subtitle">Total Available: {stats.total.ram ? Math.round(stats.total.ram / 1024) + ' GB' : 'N/A'}</p>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <h3 className="stat-title">Allocated Disk</h3>
            <HardDrive className="text-orange-500" size={20} style={{ color: '#f97316' }} />
          </div>
          <p className="stat-value">{stats.allocated.disk} GB</p>
        </div>
      </div>

      {/* VMs Table */}
      <div className="admin-table-container">
        <div className="admin-table-header">
          <h2 className="admin-table-title">All Virtual Machines</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>VM Name</th>
                <th>User</th>
                <th>Project</th>
                <th>Status</th>
                <th>IP Address</th>
                <th>Resources</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {vms.map((vm) => (
                <tr key={vm.id}>
                  <td>
                    <div className="font-medium" style={{ fontWeight: 500 }}>{vm.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{vm.id.substring(0, 8)}</div>
                  </td>
                  <td>
                    <div className="user-cell">
                        <div className="user-avatar-small">
                            {vm.project?.owner?.name?.[0] || 'U'}
                        </div>
                        <span style={{ fontSize: '0.875rem' }}>{vm.project?.owner?.email}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: '0.875rem', color: '#4b5563' }}>{vm.project?.name}</td>
                  <td>
                    <span className={`status-badge status-${vm.status}`}>
                      {vm.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.875rem', fontFamily: 'monospace', color: '#4b5563' }}>{vm.ip || '-'}</td>
                  <td style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                    <div>{vm.cpu} CPU</div>
                    <div>{vm.ram} MB RAM</div>
                    <div>{vm.disk} GB Disk</div>
                  </td>
                  <td style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    {new Date(vm.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
