import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM

KCM.SimpleKCM {
    id: page

    property alias cfg_url: urlField.text
    property alias cfg_refreshSeconds: refreshSpin.value

    Kirigami.FormLayout {
        anchors.left: parent.left
        anchors.right: parent.right

        QQC2.TextField {
            id: urlField
            Kirigami.FormData.label: "Dashboard URL:"
            placeholderText: "http://127.0.0.1:3200"
            inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoPredictiveText
        }

        QQC2.SpinBox {
            id: refreshSpin
            Kirigami.FormData.label: "Health check interval (s):"
            from: 2
            to: 300
        }

        QQC2.Label {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: "The widget polls <URL>/api/health at this interval. While the "
                  + "backend is unreachable it shows an offline overlay with a "
                  + "Retry button instead of the dashboard."
        }
    }
}
