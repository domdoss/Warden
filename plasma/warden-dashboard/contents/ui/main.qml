/*
    SPDX-FileCopyrightText: 2026 Warden
    SPDX-License-Identifier: MIT

    Warden Dashboard — Plasma 6 applet.

    Embeds the Warden web dashboard (default http://127.0.0.1:3200) as a live
    desktop widget. A lightweight /api/health probe runs on a timer; while the
    backend is unreachable an offline overlay (with a Retry button) covers the
    web view instead of a browser error page.
*/

import QtQuick
import QtQuick.Layouts
import QtWebEngine

import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    // ------------------------------------------------------------- settings
    // Normalised dashboard URL (no trailing slash) from the applet config.
    readonly property string configuredUrl: {
        var raw = Plasmoid.configuration.url;
        var u = (raw === undefined || raw === null) ? "" : ("" + raw).trim();
        if (u.length === 0)
            u = "http://127.0.0.1:3200";
        while (u.length > 1 && u.charAt(u.length - 1) === "/")
            u = u.substring(0, u.length - 1);
        return u;
    }
    readonly property string healthUrl: root.configuredUrl + "/api/health"
    readonly property int refreshSeconds: {
        var s = Number(Plasmoid.configuration.refreshSeconds);
        if (!isFinite(s) || s < 2)
            s = 10;
        return Math.round(s);
    }

    // -------------------------------------------------------- backend state
    property bool online: false
    property bool checking: false
    property string offlineReason: ""
    // Incremented per probe so a stale response can never flip the state.
    property int healthGeneration: 0

    // URL the WebEngineView is bound to. Empty until the backend is known to
    // be reachable, so a dead backend never renders a Chrome error page.
    property string viewUrl: ""
    // Bumped to ask the (independently scoped) WebEngineView to reload.
    property int reloadToken: 0

    // Render full-size when placed on a desktop/activity.
    preferredRepresentation: fullRepresentation

    toolTipMainText: "Warden Dashboard"
    toolTipSubText: root.online
        ? root.configuredUrl
        : "Backend offline — " + root.configuredUrl

    // ------------------------------------------------------ health polling
    Timer {
        id: pollTimer
        interval: root.refreshSeconds * 1000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.checkHealth()
    }

    function checkHealth() {
        var generation = ++root.healthGeneration;
        root.checking = true;

        var xhr = new XMLHttpRequest();

        function finish(ok, reason) {
            if (generation !== root.healthGeneration)
                return; // superseded by a newer probe
            root.checking = false;
            root.setBackendOnline(ok, reason);
        }

        try {
            xhr.open("GET", root.healthUrl);
            xhr.timeout = 5000;
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== XMLHttpRequest.DONE)
                    return;
                if (xhr.status >= 200 && xhr.status < 400)
                    finish(true, "");
                else if (xhr.status === 0)
                    finish(false, "Connection refused");
                else
                    finish(false, "HTTP " + xhr.status);
            };
            xhr.ontimeout = function () {
                finish(false, "Timed out");
            };
            xhr.send();
        } catch (e) {
            finish(false, "Request failed: " + e);
        }
    }

    function setBackendOnline(ok, reason) {
        var wasOnline = root.online;
        root.online = ok;
        root.offlineReason = ok ? "" : (reason && reason.length > 0 ? reason : "Warden is not reachable");

        if (ok && !wasOnline)
            root.openDashboard();
    }

    // Point the web view at the dashboard (reloading when it already has it).
    // The view lives in the fullRepresentation component, so its URL and
    // reload requests are driven through root-level state — component-scoped
    // ids are not visible here.
    function openDashboard() {
        if (!root.online)
            return;
        if (root.viewUrl !== root.configuredUrl)
            root.viewUrl = root.configuredUrl;
        else
            root.reloadToken += 1;
    }

    onConfiguredUrlChanged: {
        if (root.online)
            root.openDashboard();
    }

    // --------------------------------------------------------- compact rep
    compactRepresentation: MouseArea {
        id: compact
        implicitWidth: compactRow.implicitWidth + Kirigami.Units.smallSpacing * 2
        implicitHeight: Math.max(Kirigami.Units.iconSizes.small, compactRow.implicitHeight)
        hoverEnabled: true
        onClicked: root.expanded = !root.expanded

        RowLayout {
            id: compactRow
            anchors.centerIn: parent
            spacing: Kirigami.Units.smallSpacing

            Rectangle {
                Layout.alignment: Qt.AlignVCenter
                implicitWidth: Math.round(Kirigami.Units.gridUnit * 0.5)
                implicitHeight: implicitWidth
                radius: width / 2
                color: root.online
                    ? Kirigami.Theme.positiveTextColor
                    : Kirigami.Theme.negativeTextColor
                border.width: 1
                border.color: Qt.rgba(0, 0, 0, 0.25)

                Behavior on color { ColorAnimation { duration: 200 } }
            }

            PlasmaComponents3.Label {
                Layout.alignment: Qt.AlignVCenter
                text: "Warden"
                font: Kirigami.Theme.smallFont
            }
        }
    }

    // ------------------------------------------------------------ full rep
    fullRepresentation: Item {
        id: fullRoot

        // Reasonable footprint when first dropped, and a floor for shrinking.
        implicitWidth: Kirigami.Units.gridUnit * 60
        implicitHeight: Kirigami.Units.gridUnit * 36
        Layout.minimumWidth: Kirigami.Units.gridUnit * 20
        Layout.minimumHeight: Kirigami.Units.gridUnit * 12
        Layout.preferredWidth: Kirigami.Units.gridUnit * 60
        Layout.preferredHeight: Kirigami.Units.gridUnit * 36

        Rectangle {
            anchors.fill: parent
            color: Kirigami.Theme.backgroundColor
        }

        WebEngineView {
            id: webView
            anchors.fill: parent
            visible: root.online
            url: root.viewUrl
            backgroundColor: Kirigami.Theme.backgroundColor

            Connections {
                target: root
                function onReloadTokenChanged() {
                    webView.reload();
                }
            }
        }

        // Backend-down overlay: hides the web view (and any browser error
        // page) while /api/health is unreachable, retrying on the timer.
        Rectangle {
            anchors.fill: parent
            z: 10
            visible: !root.online
            color: Kirigami.Theme.backgroundColor

            ColumnLayout {
                anchors.centerIn: parent
                width: Math.min(parent.width - Kirigami.Units.gridUnit * 2,
                                Kirigami.Units.gridUnit * 24)
                spacing: Kirigami.Units.largeSpacing

                Kirigami.Icon {
                    source: "network-disconnect"
                    Layout.alignment: Qt.AlignHCenter
                    Layout.preferredWidth: Kirigami.Units.iconSizes.huge
                    Layout.preferredHeight: Kirigami.Units.iconSizes.huge
                    opacity: 0.85
                }

                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.Wrap
                    text: "Warden offline — retrying…"
                    font: Qt.font({
                        family: Kirigami.Theme.defaultFont.family,
                        pointSize: Math.round(Kirigami.Theme.defaultFont.pointSize * 1.4)
                    })
                }

                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.Wrap
                    opacity: 0.65
                    font: Kirigami.Theme.smallFont
                    text: {
                        if (root.checking)
                            return "Checking " + root.healthUrl;
                        var detail = root.offlineReason.length > 0
                            ? root.offlineReason
                            : "Warden is not reachable";
                        return detail + "\n" + root.healthUrl
                            + " — retrying every " + root.refreshSeconds + " s";
                    }
                }

                PlasmaComponents3.Button {
                    Layout.alignment: Qt.AlignHCenter
                    text: "Retry now"
                    icon.name: "view-refresh"
                    onClicked: {
                        root.openDashboard();
                        root.checkHealth();
                    }
                }
            }
        }
    }
}
