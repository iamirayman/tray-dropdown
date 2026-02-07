/*
 * Tray Dropdown Manager - Windows 11 Style for GNOME 49
 * Refined Grid: Max 5 Columns + Top-Left Alignment + Dynamic Chevron Icon
 * Final Stability Fix: Handles Left/Right clicks separately and stabilizes sub-menu grabs.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const MAX_COLUMNS = 5;
const ICON_SIZE = 22; 
const ITEM_CELL_SIZE = 40; 

const TrayDropdown = GObject.registerClass(
    { GTypeName: 'TrayDropdown' },
    class TrayDropdown extends PanelMenu.Button {
        _init() {
            super._init(0.5, 'Tray Dropdown', false);
            this._lockClose = false;
            this._needsRefresh = false;
            this._indicators = new Map();
            this._isInitialScan = true;

            this._mainIcon = new St.Icon({
                icon_name: 'pan-up-symbolic',
                style_class: 'system-status-icon'
            });
            this.add_child(this._mainIcon);

            this.menu.connect('open-state-changed', (menu, isOpen) => {
                this._mainIcon.icon_name = isOpen ? 'pan-down-symbolic' : 'pan-up-symbolic';
                if (!isOpen) {
                    this._lockClose = false;
                    if (this._needsRefresh) this._refreshLayout();
                }
            });

            this._iconGridContainer = new St.BoxLayout({
                vertical: true,
                style_class: 'tray-icon-grid-container',
                x_expand: true,
                y_expand: true
            });

            this._scrollView = new St.ScrollView({
                style_class: 'tray-scroll-view',
                overlay_scrollbars: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.NEVER
            });
            this._scrollView.set_child(this._iconGridContainer);
            
            this._menuItem = new PopupMenu.PopupBaseMenuItem({ 
                reactive: true,
                activate: false,
                style_class: 'tray-menu-item-wrapper'
            });
            this._menuItem.add_child(this._scrollView);
            this.menu.addMenuItem(this._menuItem);

            const originalClose = this.menu.close;
            this.menu.close = (animate) => {
                if (this._lockClose) return;
                originalClose.call(this.menu, animate);
            };

            this._watchdogId = GLib.timeout_add(GLib.PRIORITY_LOW, 3000, () => {
                this._checkGhosts();
                return GLib.SOURCE_CONTINUE;
            });
            this.show();
        }

        _refreshLayout() {
            if (this.menu.isOpen || this._lockClose) {
                this._needsRefresh = true;
                return;
            }
            if (!this._iconGridContainer || this._iconGridContainer.is_finalizing?.()) return;

            this._needsRefresh = false;
            this._iconGridContainer.remove_all_children();
            let indicatorsArray = Array.from(this._indicators.values());
            let count = indicatorsArray.length;
            
            if (count === 0) {
                if (!this._isInitialScan) this.hide();
                return;
            }

            this._isInitialScan = false;
            this.show();

            let currentRow = null;
            for (let i = 0; i < count; i++) {
                if (i % MAX_COLUMNS === 0) {
                    currentRow = new St.BoxLayout({
                        vertical: false,
                        x_expand: true,
                        x_align: Clutter.ActorAlign.START,
                        style_class: 'tray-grid-row'
                    });
                    this._iconGridContainer.add_child(currentRow);
                }
                let data = indicatorsArray[i];
                if (data.wrapper.get_parent()) data.wrapper.get_parent().remove_child(data.wrapper);
                currentRow.add_child(data.wrapper);
            }

            const cols = Math.min(count, MAX_COLUMNS);
            const rows = Math.ceil(count / MAX_COLUMNS);
            const calculatedWidth = (cols * ITEM_CELL_SIZE) + 4; 
            const calculatedHeight = (rows * ITEM_CELL_SIZE) + 4;

            this._scrollView.set_style(`
                width: ${calculatedWidth}px; 
                height: ${calculatedHeight}px;
                min-width: ${calculatedWidth}px;
                min-height: ${calculatedHeight}px;
            `);
        }

        _checkGhosts() {
            let changed = false;
            this._indicators.forEach((data, role) => {
                if (!Main.panel.statusArea[role] || !data.container || data.container.is_finalizing?.()) {
                    this._indicators.delete(role);
                    changed = true;
                }
            });
            if (changed) this._refreshLayout();
        }

        catchIndicator(role, indicator) {
            if (this._indicators.has(role) || role === this.uuid) return;
            if (!indicator || indicator.is_finalizing?.()) return;
            const isAppTrayIcon = role.toLowerCase().startsWith('appindicator-') || 
                                role.toLowerCase().includes('status-notifier') ||
                                role.toLowerCase().includes('legacy');
            if (isAppTrayIcon) {
                const container = indicator.container || indicator.actor || indicator;
                if (!container || container.is_finalizing?.()) return;
                const parent = container.get_parent();
                if (!parent || parent === this._iconGridContainer || parent.get_parent() === this._iconGridContainer) return;

                const originalParent = parent;
                try { originalParent.remove_child(container); } catch (e) { return; }
                
                container.reactive = false;
                let wrapper = new St.Button({
                    style_class: 'tray-captured-wrapper',
                    child: container,
                    reactive: true,
                    can_focus: true,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    width: ITEM_CELL_SIZE - 4,
                    height: ITEM_CELL_SIZE - 4
                });
                this._indicators.set(role, {
                    indicator: indicator,
                    container: container,
                    wrapper: wrapper,
                    originalParent: originalParent
                });
                if (indicator.menu) {
                    indicator.menu.connect('open-state-changed', (m, isOpen) => {
                        this._lockClose = isOpen;
                        if (!isOpen) {
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                                this._lockClose = false;
                                if (this._needsRefresh) this._refreshLayout();
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    });
                }
                wrapper.connect('button-press-event', (actor, event) => {
                    const button = event.get_button();
                    this._lockClose = true;
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        try {
                            if (button === 3) {
                                if (indicator.secondary_activate) {
                                    indicator.secondary_activate(event);
                                } else if (indicator.menu) {
                                    if (indicator.menu.setSourceActor) indicator.menu.setSourceActor(wrapper);
                                    indicator.menu.toggle();
                                }
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                                    if (indicator.menu && !indicator.menu.isOpen) {
                                        this._lockClose = false;
                                    }
                                    return GLib.SOURCE_REMOVE;
                                });
                            } else {
                                if (indicator.menu) {
                                    if (indicator.menu.setSourceActor) indicator.menu.setSourceActor(wrapper);
                                    indicator.menu.toggle();
                                } else if (indicator.activate) indicator.activate(event);
                            }
                        } catch (err) { this._lockClose = false; }
                        return GLib.SOURCE_REMOVE;
                    });
                    return Clutter.EVENT_STOP;
                });
                this._refreshLayout();
            }
        }

        releaseAll() {
            if (this._watchdogId) GLib.source_remove(this._watchdogId);
            this._indicators.forEach((data, role) => {
                try { 
                    if (data.container && data.originalParent) {
                        if (data.container.get_parent()) data.container.get_parent().remove_child(data.container);
                        data.originalParent.add_child(data.container);
                        data.container.reactive = true;
                        if (data.container.set_icon_size) data.container.set_icon_size(16);
                    }
                    if (data.wrapper) data.wrapper.destroy(); 
                } catch (e) {}
            });
            this._indicators.clear();
        }
    }
);

export default class TrayDropdownExtension extends Extension {
    enable() {
        this._indicator = new TrayDropdown();
        this._indicator.uuid = this.uuid;
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._scan();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._scan();
            return GLib.SOURCE_REMOVE;
        });
        this._scanTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._scan();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _scan() {
        if (!this._indicator) return;
        Object.keys(Main.panel.statusArea).forEach(role => {
            let indicator = Main.panel.statusArea[role];
            if (indicator && role !== this.uuid) this._indicator.catchIndicator(role, indicator);
        });
    }

    disable() {
        if (this._scanTimer) GLib.source_remove(this._scanTimer);
        if (this._indicator) {
            this._indicator.releaseAll();
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
