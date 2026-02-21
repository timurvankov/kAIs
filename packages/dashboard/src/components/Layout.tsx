import { NavLink, Outlet } from 'react-router-dom';

interface NavSection {
  title: string;
  items: Array<{ to: string; label: string }>;
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Core',
    items: [
      { to: '/', label: 'Overview' },
      { to: '/tree', label: 'Cell Tree' },
      { to: '/formations', label: 'Formations' },
      { to: '/missions', label: 'Missions' },
      { to: '/spawn-requests', label: 'Spawn Requests' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { to: '/experiments', label: 'Experiments' },
      { to: '/blueprints', label: 'Blueprints' },
      { to: '/knowledge', label: 'Knowledge' },
      { to: '/evolution', label: 'Evolution' },
      { to: '/swarms', label: 'Swarms' },
    ],
  },
  {
    title: 'Phase 9',
    items: [
      { to: '/human-inbox', label: 'Human Inbox' },
      { to: '/marketplace', label: 'Marketplace' },
      { to: '/federation', label: 'Federation' },
      { to: '/channels', label: 'Channels' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/roles', label: 'RBAC Roles' },
      { to: '/audit', label: 'Audit Log' },
    ],
  },
];

export function Layout() {
  return (
    <div className="min-h-screen flex">
      <nav className="w-56 bg-gray-900 border-r border-gray-800 p-4 flex flex-col gap-1 overflow-y-auto">
        <h1 className="text-lg font-bold text-white mb-4 px-2">kAIs</h1>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-3">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-3 mb-1">
              {section.title}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded text-sm ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
