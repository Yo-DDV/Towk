export type GradeVisual = {
  icon: string;
  fallbackAccent: string;
};

const SYSTEM_GRADE_VISUALS: Record<string, GradeVisual> = {
  owner: {
    icon: 'mdi--shield-crown-outline',
    fallbackAccent: '#D97706'
  },
  admin: {
    icon: 'mdi--account-cog-outline',
    fallbackAccent: '#8B5CF6'
  },
  moderator: {
    icon: 'mdi--shield-account-outline',
    fallbackAccent: '#16A34A'
  },
  helper: {
    icon: 'mdi--hand-heart-outline',
    fallbackAccent: '#0891B2'
  },
  everyone: {
    icon: 'mdi--account-group-outline',
    fallbackAccent: '#64748B'
  }
};

const CUSTOM_GRADE_VISUAL: GradeVisual = {
  icon: 'mdi--tune-variant',
  fallbackAccent: '#64748B'
};

export function gradeVisual(roleName: string): GradeVisual {
  return SYSTEM_GRADE_VISUALS[roleName] ?? CUSTOM_GRADE_VISUAL;
}
