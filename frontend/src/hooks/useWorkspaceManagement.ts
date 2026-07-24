'use client';

import { useState, useCallback } from 'react';
import { api, UserWorkspaceMembership, WorkspaceGroupMapping } from '@/services/api';

/**
 * Hook pour gérer les workspace group mappings (liaison SSO groups → workspaces)
 */
export function useWorkspaceGroupMappings(workspaceId: string) {
  const [mappings, setMappings] = useState<WorkspaceGroupMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getWorkspaceGroupMappings(workspaceId);
      setMappings(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group mappings');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const addMapping = useCallback(
    async (idpGroup: string, role: string) => {
      try {
        await api.addWorkspaceGroupMapping(workspaceId, idpGroup, role);
        await loadMappings();
        return null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to add mapping';
        setError(errMsg);
        return errMsg;
      }
    },
    [workspaceId, loadMappings]
  );

  const deleteMapping = useCallback(
    async (idpGroup: string) => {
      try {
        await api.deleteWorkspaceGroupMapping(workspaceId, idpGroup);
        await loadMappings();
        return null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to delete mapping';
        setError(errMsg);
        return errMsg;
      }
    },
    [workspaceId, loadMappings]
  );

  return {
    mappings,
    loading,
    error,
    loadMappings,
    addMapping,
    deleteMapping,
    setMappings,
    setError,
  };
}

/**
 * Hook pour gérer les workspace members (utilisateurs ayant accès à un workspace)
 */
export function useWorkspaceMembers(workspaceId: string) {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getWorkspaceMembers(workspaceId);
      setMembers(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const updateMember = useCallback(
    async (username: string, role: string) => {
      try {
        await api.updateWorkspaceMember(workspaceId, username, role);
        await loadMembers();
        return null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to update member';
        setError(errMsg);
        return errMsg;
      }
    },
    [workspaceId, loadMembers]
  );

  const removeMember = useCallback(
    async (username: string) => {
      try {
        await api.deleteWorkspaceMember(workspaceId, username);
        await loadMembers();
        return null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to remove member';
        setError(errMsg);
        return errMsg;
      }
    },
    [workspaceId, loadMembers]
  );

  return {
    members,
    loading,
    error,
    loadMembers,
    updateMember,
    removeMember,
    setMembers,
    setError,
  };
}

/**
 * Hook pour gérer les workspaces d'un utilisateur spécifique
 */
export function useUserWorkspaces(username: string) {
  const [workspaces, setWorkspaces] = useState<UserWorkspaceMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    if (!username) {
      setWorkspaces([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getUserWorkspaces(username);
      setWorkspaces(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user workspaces');
    } finally {
      setLoading(false);
    }
  }, [username]);

  return {
    workspaces,
    loading,
    error,
    loadWorkspaces,
    setWorkspaces,
    setError,
  };
}

/**
 * Hook pour gérer les validations de formulaire pour workspace CRUD
 */
export function useWorkspaceFormValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateRole = (role: string): boolean => {
    const validRoles = ['viewer', 'editor', 'administrator'];
    if (!validRoles.includes(role)) {
      setErrors(prev => ({ ...prev, role: 'Invalid role selected' }));
      return false;
    }
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors.role;
      return newErrors;
    });
    return true;
  };

  const validateGroupMapping = (idpGroup: string, role: string): boolean => {
    const newErrors: Record<string, string> = {};

    if (!idpGroup || !idpGroup.trim()) {
      newErrors.idpGroup = 'IDP group cannot be empty';
    }

    const validRoles = ['viewer', 'editor', 'administrator'];
    if (!validRoles.includes(role)) {
      newErrors.role = 'Invalid role selected';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const clearErrors = () => setErrors({});

  return {
    errors,
    validateRole,
    validateGroupMapping,
    clearErrors,
  };
}
