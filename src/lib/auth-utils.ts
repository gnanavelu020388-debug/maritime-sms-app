export function roleLabel(role: 'super_admin' | 'company_admin' | 'dpa' | 'vessel'): string {
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'company_admin': return 'Company Admin';
    case 'dpa': return 'DPA';
    case 'vessel': return 'Vessel Crew';
  }
}

export function rankLabel(rank: string): string {
  return rank;
}
