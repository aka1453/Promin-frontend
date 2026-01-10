export type ProjectRole = 'owner' | 'editor' | 'viewer';

export function canEdit(role?: 'owner' | 'editor' | 'viewer' | null) {
  if (!role) return false;
  return role === 'owner' || role === 'editor';
}

export function isOwner(role?: 'owner' | 'editor' | 'viewer' | null) {
  return role === 'owner';
}

