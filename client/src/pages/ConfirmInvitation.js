import React, { useEffect, useState, useContext } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import api from '../api';
import { AuthContext } from '../context/AuthContext';
import { CheckCircle, XCircle, Loader, Mail } from 'lucide-react';

const ConfirmInvitation = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, loading: authLoading, login } = useContext(AuthContext);
    const [status, setStatus] = useState('loading'); // loading, success, error, requires_registration
    const [message, setMessage] = useState('');
    const [invitationDetails, setInvitationDetails] = useState(null);

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const token = queryParams.get('token');
        const emailFromRegister = queryParams.get('email'); // From successful registration redirect

        if (!token) {
            setStatus('error');
            setMessage('Invitation token missing.');
            return;
        }

        const confirm = async () => {
            try {
                const response = await api.get(`/projects/invite/confirm/${token}`);
                
                if (response.data.requiresRegistration) {
                    setStatus('requires_registration');
                    setInvitationDetails(response.data.invitation);
                    setMessage(`A user with email ${response.data.invitation.email} is not registered. Please register first.`);
                } else {
                    setStatus('success');
                    setMessage(response.data.message || 'You have successfully joined the project!');
                    
                    // Optionally redirect to project dashboard if `response.data.project` is available
                    if (response.data.project) {
                        setTimeout(() => navigate(`/projects/${response.data.project}`), 2000);
                    }
                }
            } catch (err) {
                setStatus('error');
                setMessage(err.response?.data?.error || 'Failed to confirm invitation.');
            }
        };

        // If user just registered and was redirected here with an email and token,
        // they are now logged in (or will be after authLoading finishes), so re-attempt confirmation.
        if (!authLoading && user && emailFromRegister && token) {
            // User is logged in after registration, re-attempt confirmation now
            confirm();
        } else if (!authLoading && !user && !emailFromRegister) {
            // Not logged in and not coming from registration, proceed with initial confirmation attempt
            confirm();
        } else if (!authLoading && user && !emailFromRegister) {
            // User is already logged in (maybe via existing session), confirm directly
            confirm();
        }

    }, [location.search, authLoading, user, navigate, login]);

    const renderContent = () => {
        switch (status) {
            case 'loading':
                return (
                    <div className="flex flex-col items-center">
                        <Loader size={48} className="animate-spin text-primary-color mb-4" />
                        <p className="text-lg text-gray-700">Confirming your invitation...</p>
                    </div>
                );
                
            case 'success':
                return (
                    <div className="flex flex-col items-center">
                        <CheckCircle size={48} className="text-green-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800 mb-2">Invitation Accepted!</h2>
                        <p className="text-gray-600 mb-4">{message}</p>
                        <Link to="/" className="btn-primary">Go to Dashboard</Link>
                    </div>
                );
                
            case 'error':
                return (
                    <div className="flex flex-col items-center">
                        <XCircle size={48} className="text-red-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800 mb-2">Error</h2>
                        <p className="text-gray-600 mb-4">{message}</p>
                        <Link to="/login" className="btn-primary">Go to Login</Link>
                    </div>
                );
                
            case 'requires_registration':
                return (
                    <div className="flex flex-col items-center">
                        <Mail size={48} className="text-yellow-500 mb-4" />
                        <h2 className="text-xl font-semibold text-gray-800 mb-2">Action Required</h2>
                        <p className="text-gray-600 mb-4">{message}</p>
                        <p className="text-gray-600 mb-4">
                            Please register with the email <strong>{invitationDetails?.email}</strong> to join the project.
                        </p>
                        <Link 
                            to={`/register?email=${invitationDetails?.email}&token=${invitationDetails?.token}`} 
                            className="btn-primary"
                        >
                            Register Now
                        </Link>
                        <Link to="/login" className="text-link mt-4">
                            Already have an account? Log in
                        </Link>
                    </div>
                );
                
            default:
                return null;
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-form-card p-8">
                {renderContent()}
            </div>
        </div>
    );
};

export default ConfirmInvitation;