import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';
import { Plus, Server, Users, Trash2, Play, Square, RotateCw, MoreVertical, Box, Globe, Terminal } from 'lucide-react';
import { toast } from 'react-toastify';

const ProjectDetails = () => {
  const { id, category } = useParams();
  const [project, setProject] = useState(null);
  const [showVMModal, setShowVMModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [newVM, setNewVM] = useState({ name: '', type: 'app', framework: 'node', githubUrl: '', dockerImage: '', ram: 2048, cpu: 2, disk: 20 });
  const [newUser, setNewUser] = useState({ email: '', role: 'viewer' });
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  useEffect(() => {
    fetchProject();
  }, [id]);

  // Filter VMs based on category
  const getFilteredVMs = () => {
      if (!project || !project.vms) return [];
      if (!category) return project.vms; // Overview shows all

      if (category === 'apps') {
          return project.vms.filter(vm => vm.type === 'app' || vm.type === 'docker');
      }
      if (category === 'kubernetes') {
          return project.vms.filter(vm => vm.type === 'k8s');
      }
      return [];
  };

  const filteredVMs = getFilteredVMs();
  const sectionTitle = !category ? 'Overview' : (category === 'apps' ? 'Apps & Docker' : 'Kubernetes Clusters');

  useEffect(() => {
      if (showVMModal) {
          fetchRepos();
      }
  }, [showVMModal]);

  const fetchRepos = async () => {
      setLoadingRepos(true);
      try {
          const response = await api.get('/github/repos');
          setRepos(response.data);
      } catch (error) {
          console.log('GitHub repos not available');
      } finally {
          setLoadingRepos(false);
      }
  };

  const fetchProject = async () => {
    try {
      const response = await api.get(`/projects/${id}`);
      setProject(response.data);
    } catch (error) {
      toast.error('Failed to fetch project details');
    }
  };

  const handleCreateVM = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/projects/${id}/vms`, newVM);
      toast.success('VM creation started');
      setShowVMModal(false);
      fetchProject();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create VM');
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/projects/${id}/users`, newUser);
      toast.success('User added to project');
      setShowUserModal(false);
      setNewUser({ email: '', role: 'viewer' });
      fetchProject();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add user');
    }
  };

  const handleVMAction = async (vmId, action) => {
    try {
      await api.post(`/vms/${vmId}/${action}`);
      toast.success(`VM ${action} command sent`);
      fetchProject();
    } catch (error) {
      toast.error(`Failed to ${action} VM`);
    }
  };

  const handleDeleteVM = async (vmId) => {
    if (!window.confirm('Are you sure you want to delete this VM?')) return;
    try {
      await api.delete(`/vms/${vmId}`);
      toast.success('VM deleted');
      fetchProject();
    } catch (error) {
      toast.error('Failed to delete VM');
    }
  };

  if (!project) return <div>Loading...</div>;

  return (
    <div className="project-details-content">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">{project.name}</h1>
          <p style={{ color: '#6b7280', margin: '5px 0 0 0' }}>{project.description}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setShowUserModal(true)}
              className="btn-secondary"
              style={{ background: 'white', border: '1px solid #d1d5db', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <Users size={18} /> Invite
            </button>
            <button
              onClick={() => setShowVMModal(true)}
              className="btn-create"
            >
              Create Resource
            </button>
        </div>
      </div>

      <div className="resources-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="section-title" style={{ fontSize: '1.2rem', fontWeight: '600' }}>{sectionTitle}</h2>
        </div>
        
        <div className="resources-list" style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
            {filteredVMs.map((vm) => (
              <div key={vm.id} className="resource-row" style={{ display: 'flex', alignItems: 'center', padding: '1rem', borderBottom: '1px solid #e5e7eb', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ background: '#f3f4f6', padding: '10px', borderRadius: '50%' }}>
                        {vm.type === 'k8s' ? <Box size={20} color="#3b82f6" /> : <Server size={20} color="#3b82f6" />}
                    </div>
                    <div>
                        <Link to={`/vms/${vm.id}`} style={{ fontWeight: '600', color: '#111827', textDecoration: 'none', fontSize: '1rem', display: 'block' }}>
                            {vm.name}
                        </Link>
                        <div style={{ display: 'flex', gap: '10px', fontSize: '0.85rem', color: '#6b7280', marginTop: '4px' }}>
                            <span>{vm.type === 'app' ? vm.framework : (vm.type === 'docker' ? vm.dockerImage : 'Kubernetes')}</span>
                            <span>•</span>
                            <span>{vm.ip || 'No IP'}</span>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <span className={`vm-status-tag ${
                      vm.status === 'running' ? 'vm-status-running' :
                      vm.status === 'deployed' ? 'vm-status-deployed' :
                      vm.status === 'error' ? 'vm-status-error' :
                      'vm-status-default'
                    }`}>
                      {vm.status}
                    </span>
                    
                    <div className="resource-actions" style={{ display: 'flex', gap: '5px' }}>
                        {vm.appUrl && (
                            <a href={vm.appUrl} target="_blank" rel="noopener noreferrer" className="icon-btn" title="Open App">
                                <Globe size={18} />
                            </a>
                        )}
                        <Link to={`/vms/${vm.id}`} className="icon-btn" title="Console">
                            <Terminal size={18} />
                        </Link>
                        <button onClick={() => handleVMAction(vm.id, 'start')} className="icon-btn" title="Start"><Play size={18} /></button>
                        <button onClick={() => handleVMAction(vm.id, 'stop')} className="icon-btn" title="Stop"><Square size={18} /></button>
                        <button onClick={() => handleDeleteVM(vm.id)} className="icon-btn" title="Delete" style={{ color: '#ef4444' }}><Trash2 size={18} /></button>
                    </div>
                </div>
              </div>
            ))}
            {filteredVMs.length === 0 && (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
                    <p>No resources found in this category.</p>
                    <button onClick={() => setShowVMModal(true)} style={{ color: '#0069ff', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600', marginTop: '10px' }}>
                        Create a resource
                    </button>
                </div>
            )}
        </div>
      </div>

      {/* VM Modal */}
        {showVMModal && (
          <div className="modal-overlay">
            <div className="modal-card">
              <h2 className="modal-title">Create New Resource</h2>
              <form onSubmit={handleCreateVM}>
                <div className="modal-form-group">
                  <label className="modal-form-label">Name</label>
                  <input type="text" className="modal-form-input" value={newVM.name} onChange={(e) => setNewVM({ ...newVM, name: e.target.value })} placeholder="my-app-01" />
                </div>

                <div className="modal-form-group">
                  <label className="modal-form-label">Deployment Type</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                    <div 
                        onClick={() => setNewVM({ ...newVM, type: 'app' })}
                        style={{ 
                            border: `1px solid ${newVM.type === 'app' ? '#0069ff' : '#e5e7eb'}`, 
                            padding: '10px', 
                            borderRadius: '6px', 
                            cursor: 'pointer',
                            textAlign: 'center',
                            background: newVM.type === 'app' ? '#eff6ff' : 'white'
                        }}
                    >
                        App (GitHub)
                    </div>
                    <div 
                        onClick={() => setNewVM({ ...newVM, type: 'docker' })}
                        style={{ 
                            border: `1px solid ${newVM.type === 'docker' ? '#0069ff' : '#e5e7eb'}`, 
                            padding: '10px', 
                            borderRadius: '6px', 
                            cursor: 'pointer',
                            textAlign: 'center',
                            background: newVM.type === 'docker' ? '#eff6ff' : 'white'
                        }}
                    >
                        Docker
                    </div>
                    <div 
                        onClick={() => setNewVM({ ...newVM, type: 'k8s' })}
                        style={{ 
                            border: `1px solid ${newVM.type === 'k8s' ? '#0069ff' : '#e5e7eb'}`, 
                            padding: '10px', 
                            borderRadius: '6px', 
                            cursor: 'pointer',
                            textAlign: 'center',
                            background: newVM.type === 'k8s' ? '#eff6ff' : 'white'
                        }}
                    >
                        Kubernetes
                    </div>
                  </div>
                </div>

                {newVM.type === 'app' && (
                  <>
                    <div className="modal-form-group">
                      <label className="modal-form-label">Framework</label>
                      <select className="modal-form-input" value={newVM.framework} onChange={(e) => setNewVM({ ...newVM, framework: e.target.value })}>
                        <option value="node">Node.js</option>
                        <option value="python">Python</option>
                        <option value="go">Go</option>
                      </select>
                    </div>
                    <div className="modal-form-group">
                      <label className="modal-form-label">GitHub URL (Optional)</label>
                      {repos.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <select 
                                className="modal-form-input" 
                                value={newVM.githubUrl} 
                                onChange={(e) => {
                                    const url = e.target.value;
                                    setNewVM({ ...newVM, githubUrl: url });
                                    // Auto-detect framework
                                    const repo = repos.find(r => r.html_url === url);
                                    if (repo && repo.language) {
                                        const lang = repo.language.toLowerCase();
                                        if (lang.includes('javascript') || lang.includes('typescript')) setNewVM(prev => ({ ...prev, framework: 'node', githubUrl: url }));
                                        else if (lang.includes('python')) setNewVM(prev => ({ ...prev, framework: 'python', githubUrl: url }));
                                        else if (lang.includes('go')) setNewVM(prev => ({ ...prev, framework: 'go', githubUrl: url }));
                                    }
                                }}
                            >
                                <option value="">Select a repository or leave empty</option>
                                {repos.map(repo => (
                                    <option key={repo.id} value={repo.html_url}>
                                        {repo.full_name} ({repo.language || 'Unknown'})
                                    </option>
                                ))}
                            </select>
                            <small style={{ color: '#666', cursor: 'pointer' }} onClick={() => setRepos([])}>Switch to manual input</small>
                          </div>
                      ) : (
                        <input type="text" className="modal-form-input" value={newVM.githubUrl} onChange={(e) => setNewVM({ ...newVM, githubUrl: e.target.value })} placeholder="https://github.com/user/repo" />
                      )}
                      {loadingRepos && <small>Loading repositories...</small>}
                    </div>
                  </>
                )}

                {newVM.type === 'docker' && (
                  <div className="modal-form-group">
                    <label className="modal-form-label">Docker Image</label>
                    <input type="text" className="modal-form-input" value={newVM.dockerImage} onChange={(e) => setNewVM({ ...newVM, dockerImage: e.target.value })} placeholder="e.g. nginx:latest, postgres:15" />
                  </div>
                )}

                {newVM.type === 'k8s' && (
                  <div className="modal-info-box" style={{ padding: '10px', backgroundColor: '#f0f9ff', borderRadius: '4px', fontSize: '0.9em', marginBottom: '15px' }}>
                    This will deploy a single-node K3s cluster. You can access it via the terminal or exposed API port.
                  </div>
                )}

                <div className="modal-form-row modal-form-group">
                  <div>
                    <label className="modal-form-label">RAM (MB)</label>
                    <input type="number" className="modal-form-input" value={newVM.ram} onChange={(e) => setNewVM({ ...newVM, ram: parseInt(e.target.value) })} />
                  </div>
                  <div>
                    <label className="modal-form-label">CPU (Cores)</label>
                    <input type="number" className="modal-form-input" value={newVM.cpu} onChange={(e) => setNewVM({ ...newVM, cpu: parseInt(e.target.value) })} />
                  </div>
                </div>
                <div className="modal-actions">
                  <button type="button" onClick={() => setShowVMModal(false)} className="btn-cancel">Cancel</button>
                  <button type="submit" className="btn-modal-create">Create</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* User Modal */}
        {showUserModal && (
          <div className="modal-overlay">
            <div className="modal-card">
              <h2 className="modal-title">Add Member</h2>
              <form onSubmit={handleAddUser}>
                <div className="modal-form-group">
                  <label className="modal-form-label">Email</label>
                  <input type="email" className="modal-form-input" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} required />
                </div>
                <div className="modal-form-group">
                  <label className="modal-form-label">Role</label>
                  <select className="modal-form-input" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="modal-actions">
                  <button type="button" onClick={() => setShowUserModal(false)} className="btn-cancel">Cancel</button>
                  <button type="submit" className="btn-modal-create btn-add-member-modal">Add</button>
                </div>
              </form>
            </div>
          </div>
        )}
    </div>
  );
};

export default ProjectDetails;