# Configuration Google Apps Script

Ce script Google Apps Script doit être copié dans ton Google Sheet pour que la synchronisation des réservations fonctionne correctement.

## Instructions de configuration

1. Ouvre ton Google Sheet
2. Va dans **Outils** → **Éditeur de script**
3. Remplace tout le code par le script ci-dessous
4. Sauvegarde le script
5. Va dans **Déployer** → **Nouveau déploiement**
6. Choisis **Type** : "Application web"
7. Configure : **Exécuter en tant que** : Toi (ton compte)
8. Configure : **Accès** : "Quiconque"
9. Clique sur "Déployer"
10. Copie l'URL du déploiement et mets-la dans le fichier `.env` du projet (remplace `GOOGLE_SCRIPT_URL`)

## Google Apps Script Code

```javascript
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Extraire les informations
    const {
      type,
      classId,
      classTitle,
      date,
      time,
      location,
      capacity,
      studentName,
      paymentMethod,
      paymentStatus,
      sheetName
    } = payload;

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Créer les onglets s'ils n'existent pas
    ensureSheetExists(ss, 'A Regler');
    ensureSheetExists(ss, 'Payer');

    if (type === 'BOOKING') {
      // Nouvelle réservation
      addBooking(ss, sheetName, classId, classTitle, date, time, location, capacity, studentName, paymentMethod, paymentStatus);
    } else if (type === 'BOOKING_UPDATE') {
      // Mise à jour du statut de paiement
      moveBooking(ss, classId, studentName, paymentStatus);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('Erreur: ' + error);
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function ensureSheetExists(ss, sheetName) {
  try {
    ss.getSheetByName(sheetName);
  } catch (e) {
    const sheet = ss.insertSheet(sheetName);
    // Ajouter les en-têtes
    sheet.appendRow(['ID', 'Cour', 'Date', 'Heure', 'Lieu', 'Inscrits', 'Élève (+Méthode de réglement)']);
    // Formater les en-têtes
    const headerRange = sheet.getRange(1, 1, 1, 7);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#d4af37');
    headerRange.setFontColor('#000000');
  }
}

function addBooking(ss, sheetName, classId, classTitle, date, time, location, capacity, studentName, paymentMethod, paymentStatus) {
  const sheet = ss.getSheetByName(sheetName);

  // Vérifier si la réservation existe déjà
  const data = sheet.getDataRange().getValues();
  let found = false;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classId && data[i][6].includes(studentName)) {
      found = true;
      break;
    }
  }

  if (!found) {
    const inscription = `${studentName} (${paymentMethod})`;
    sheet.appendRow([classId, classTitle, date, time, location, capacity, inscription]);
  }
}

function moveBooking(ss, classId, studentName, newPaymentStatus) {
  const sourceSheet = newPaymentStatus === 'PAID' ? 'A Regler' : 'Payer';
  const destSheet = newPaymentStatus === 'PAID' ? 'Payer' : 'A Regler';

  const source = ss.getSheetByName(sourceSheet);
  const dest = ss.getSheetByName(destSheet);

  if (!source || !dest) return;

  const sourceData = source.getDataRange().getValues();
  let rowToMove = -1;

  // Trouver la ligne à déplacer
  for (let i = 1; i < sourceData.length; i++) {
    if (sourceData[i][0] === classId && sourceData[i][6].includes(studentName)) {
      rowToMove = i;
      break;
    }
  }

  if (rowToMove > -1) {
    // Copier la ligne vers la destination
    const row = sourceData[rowToMove];
    dest.appendRow(row);

    // Supprimer la ligne de la source
    source.deleteRow(rowToMove + 1);
  }
}

function doGet(e) {
  return ContentService.createTextOutput('Google Apps Script en ligne').setMimeType(ContentService.MimeType.TEXT);
}
```

## Fonctionnalités

✅ **Création automatique des onglets** "A Regler" et "Payer"
✅ **Ajout automatique des réservations** dans le bon onglet selon le statut
✅ **Déplacement automatique** d'une réservation quand le statut passe de "À régler" à "Payé"
✅ **En-têtes formatés** avec les colonnes demandées
✅ **Évite les doublons** dans les feuilles

## Variables d'environnement

Mets à jour ton fichier `.env` :
```
VITE_GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/[TON_ID_DE_DEPLOIEMENT]/usercontent
```

Remplace `[TON_ID_DE_DEPLOIEMENT]` par l'ID fourni après le déploiement du script.
