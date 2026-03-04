import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { Plus, Folder, MoreHorizontal, Server, Box, Layers } from 'lucide-react';
import { toast } from 'react-toastify';

const Dashboard = () => {
  const [projects, setProjects] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '' });

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects');
      setProjects(response.data);
    } catch (error) {
      toast.error('Failed to fetch projects');
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    try {
      await api.post('/projects', newProject);
      toast.success('Project created');
      setShowModal(false);
      setNewProject({ name: '', description: '' });
      fetchProjects();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create project');
    }
  };

  // Helper to count resources (mock logic, ideally backend returns counts)
  const getResourceCount = (project) => {
      // This assumes project.vms is populated, which might require backend update or separate call
      // For now, we just show a placeholder or if the API returns it
      return project.vms ? project.vms.length : 0;
  };

  return (
    <div className="dashboard-content">
      <div className="dashboard-header">
        <div>
            <h1 className="dashboard-title">Projects</h1>
            <p className="text-secondary" style={{ marginTop: '5px' }}>Manage your cloud infrastructure projects.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-create"
        >
          <Plus size={18} style={{ marginRight: '8px' }} />
          Create Project
        </button>
      </div>

      <div className="projects-grid">
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}`}
            className="project-card"
          >
            <div className="project-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="project-icon-wrapper">
                    <Folder className="project-card-icon" size={24} />
                </div>
                <div>
                    <h2 className="project-card-title">{project.name}</h2>
                    <span className="project-card-role">
                        {project.users?.[0]?.ProjectUser?.role || 'Owner'}
                    </span>
                </div>
              </div>
              <button className="icon-btn">
                <MoreHorizontal size={20} />
              </button>
            </div>
            
            <p className="project-card-description">{project.description || 'No description provided.'}</p>
            
            <div className="project-card-footer">
                <div className="resource-badge">
                    <Server size={14} />
                    <span>{project.vms?.length || 0} Resources</span>
                </div>
                <div className="project-date">
                    Updated {new Date(project.updatedAt).toLocaleDateString()}
                </div>
            </div>
          </Link>
        ))}
        
        {/* Empty state or "Create" card */}
        {projects.length === 0 && (
            <div className="project-card empty-state-card" onClick={() => setShowModal(true)}>
                <div className="empty-state-icon">
                    <Plus size={32} />
                </div>
                <h3>Create your first project</h3>
                <p>Organize your resources and collaborate with your team.</p>
            </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2 className="modal-title">Create New Project</h2>
            <p className="modal-subtitle">Projects help you organize your resources.</p>
            <form onSubmit={handleCreateProject}>
              <div className="modal-form-group">
                <label className="modal-form-label">Name</label>
                <input
                  type="text"
                  className="modal-form-input"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  required
                  placeholder="e.g. My Startup, Client X"
                  autoFocus
                />
              </div>
              <div className="modal-form-group">
                <label className="modal-form-label">Description (Optional)</label>
                <textarea
                  className="modal-form-textarea"
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="What is this project about?"
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-create"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;