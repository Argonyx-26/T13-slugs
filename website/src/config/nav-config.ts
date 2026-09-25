import { NavGroup } from '@/types';

/**
 * Navigation configuration, used for both the sidebar and the Cmd+K bar.
 * Items are organized into groups, each rendered with a SidebarGroupLabel.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Clinic',
    items: [
      {
        title: 'Patients',
        url: '/patients',
        icon: 'teams',
        isActive: false,
        shortcut: ['p', 'p'],
        items: []
      }
    ]
  }
];
