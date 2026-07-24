import { beforeEach, describe, expect, it } from 'vitest';
import { SidebarNavState } from './globals.svelte';

describe('SidebarNavState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults the desktop sidebar to open for a fresh session', () => {
    const sidebar = new SidebarNavState();

    expect(sidebar.isOpen).toBe(true);
  });

  it('remembers desktop toggles for the current app session', () => {
    const sidebar = new SidebarNavState(true);

    sidebar.toggle();
    expect(sidebar.isOpen).toBe(false);

    sidebar.toggle();
    expect(sidebar.isOpen).toBe(true);
  });

  it('allows a route to consume the app-header menu action', () => {
    const sidebar = new SidebarNavState();
    let calls = 0;
    const unregister = sidebar.registerToggleHandler(() => {
      calls++;
      return true;
    });

    sidebar.toggle();
    expect(calls).toBe(1);
    expect(sidebar.isOpen).toBe(true);

    unregister();
    sidebar.toggle();
    expect(sidebar.isOpen).toBe(false);
  });

  it('falls back to the normal toggle when a route does not consume the action', () => {
    const sidebar = new SidebarNavState();
    sidebar.registerToggleHandler(() => false);

    sidebar.toggle();

    expect(sidebar.isOpen).toBe(false);
  });

  it('uses the most recently registered route handler', () => {
    const sidebar = new SidebarNavState();
    const calls: string[] = [];
    sidebar.registerToggleHandler(() => {
      calls.push('first');
      return true;
    });
    const unregisterSecond = sidebar.registerToggleHandler(() => {
      calls.push('second');
      return true;
    });

    sidebar.toggle();
    unregisterSecond();
    sidebar.toggle();

    expect(calls).toEqual(['second', 'first']);
  });

  it('does not persist mobile overlay open and close changes', () => {
    const sidebar = new SidebarNavState();

    sidebar.setMobile(true);
    expect(sidebar.isOpen).toBe(false);

    sidebar.toggle();
    expect(sidebar.isOpen).toBe(true);

    sidebar.close();
    expect(sidebar.isOpen).toBe(false);

    sidebar.setMobile(false);
    expect(sidebar.isOpen).toBe(true);
  });

  it('opens the sidebar without changing a closed desktop preference from mobile', () => {
    const sidebar = new SidebarNavState();

    sidebar.toggle();
    expect(sidebar.isOpen).toBe(false);

    sidebar.setMobile(true);
    sidebar.open();
    expect(sidebar.isOpen).toBe(true);

    sidebar.setMobile(false);
    expect(sidebar.isOpen).toBe(false);
  });

  it('restores a closed desktop preference after mobile use', () => {
    const sidebar = new SidebarNavState();

    sidebar.toggle();
    expect(sidebar.isOpen).toBe(false);

    sidebar.setMobile(true);
    sidebar.toggle();
    expect(sidebar.isOpen).toBe(true);

    sidebar.setMobile(false);
    expect(sidebar.isOpen).toBe(false);
  });
});
