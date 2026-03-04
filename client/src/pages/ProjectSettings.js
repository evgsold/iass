import React, { useState, useEffect, useContext } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { AuthContext } from '../context/AuthContext';
import { Trash2, Shield, Save, User, Check } from 'lucide-react';
import { toast } from 'react-toastify';

const ProjectSettings = () => {
  const { id } = useParams();
  const { user: currentUser } = useContext(AuthContext);
  const [project, setProject] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProject();
  }, [id]);

  const fetchProject = async () => {
    try {
      const response = await api.get(`/projects/${id}`);
      setProject(response.data);
      setUsers(response.data.users || []);
    } catch (error) {
      toast.error('Failed to fetch project settings');
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionChange = async (userId, permission, value) => {
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return;

    const updatedUsers = [...users];
    const userToUpdate = updatedUsers[userIndex];
    
    // Deep copy permissions to avoid mutation issues
    const currentPermissions = userToUpdate.ProjectUser.permissions || {};
    const newPermissions = { ...currentPermissions, [permission]: value };
    
    userToUpdate.ProjectUser.permissions = newPermissions;
    setUsers(updatedUsers);

    try {
      await api.put(`/projects/${id}/users/${userId}/permissions`, {
        permissions: newPermissions
      });
      toast.success('Permissions updated');
    } catch (error) {
      toast.error('Failed to update permissions');
      // Revert on error
      fetchProject(); 
    }
  };

  const handleRemoveUser = async (userId) => {
    if (!window.confirm('Are you sure you want to remove this user from the project?')) return;
    
    try {
      await api.delete(`/projects/${id}/users/${userId}`);
      setUsers(users.filter(u => u.id !== userId));
      toast.success('User removed');
    } catch (error) {
      toast.error('Failed to remove user');
    }
  };

  if (loading) return <div className="p-8 text-center">Loading settings...</div>;
  if (!project) return <div className="p-8 text-center">Project not found</div>;

  // Check if current user has access to manage settings
  const currentProjectUser = users.find(u => u.id === currentUser?.id);
  const canManage = currentProjectUser?.ProjectUser?.role === 'admin' || currentProjectUser?.ProjectUser?.permissions?.canManageAccess;

  if (!canManage) {
    return (
      <div className="p-8 text-center">
        <Shield size={48} className="mx-auto text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-700">Access Denied</h2>
        <p className="text-gray-500">You do not have permission to manage this project's settings.</p>
      </div>
    );
  }

  return (
    <div className="project-settings-content">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Project Settings</h1>
          <p className="text-secondary">Manage access and permissions for {project.name}</p>
        </div>
      </div>

      <div className="settings-section">
        <h2 className="section-title">Team Members & Permissions</h2>
        
        <div className="members-list">
          {users.map((member) => (
            <div key={member.id} className="member-card">
              <div className="member-info">
                <div className="member-avatar">
                  <User size={20} />
                </div>
                <div>
                  <div className="member-name">{member.name} {member.id === currentUser?.id && '(You)'}</div>
                  <div className="member-email">{member.email}</div>
                  <div className="member-role-badge">{member.ProjectUser.role}</div>
                </div>
              </div>

              <div className="permissions-grid">
                <PermissionToggle 
                  label="Create Resources" 
                  checked={member.ProjectUser.permissions?.canCreateVM} 
                  onChange={(val) => handlePermissionChange(member.id, 'canCreateVM', val)}
                  disabled={member.ProjectUser.role === 'admin'}
                />
                <PermissionToggle 
                  label="Delete Resources" 
                  checked={member.ProjectUser.permissions?.canDeleteVM} 
                  onChange={(val) => handlePermissionChange(member.id, 'canDeleteVM', val)}
                  disabled={member.ProjectUser.role === 'admin'}
                />
                <PermissionToggle 
                  label="Start/Stop" 
                  checked={member.ProjectUser.permissions?.canStartStopVM} 
                  onChange={(val) => handlePermissionChange(member.id, 'canStartStopVM', val)}
                  disabled={member.ProjectUser.role === 'admin'}
                />
                <PermissionToggle 
                  label="View Logs" 
                  checked={member.ProjectUser.permissions?.canViewLogs} 
                  onChange={(val) => handlePermissionChange(member.id, 'canViewLogs', val)}
                  disabled={member.ProjectUser.role === 'admin'}
                />
                <PermissionToggle 
                  label="Manage Access" 
                  checked={member.ProjectUser.permissions?.canManageAccess} 
                  onChange={(val) => handlePermissionChange(member.id, 'canManageAccess', val)}
                  disabled={member.ProjectUser.role === 'admin'}
                />
              </div>

              <div className="member-actions">
                {member.ProjectUser.role !== 'admin' && (
                  <button 
                    onClick={() => handleRemoveUser(member.id)}
                    className="btn-icon-danger"
                    title="Remove User"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const PermissionToggle = ({ label, checked, onChange, disabled }) => (
  <label className={`permission-toggle ${disabled ? 'disabled' : ''}`}>
    <input 
      type="checkbox" 
      checked={!!checked} 
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
    />
    <span className="toggle-label">{label}</span>
  </label>
);

export default ProjectSettings;
