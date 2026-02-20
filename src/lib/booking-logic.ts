// src/lib/booking-logic.ts
import { runTransaction, doc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function bookClass(userId: string, classId: string, cost: number) {
  const classRef = doc(db, "classes", classId);
  const userRef = doc(db, "users", userId);
  const newBookingRef = doc(db, "bookings", crypto.randomUUID()); // Génère un ID unique
  const newTransactionRef = doc(db, "transactions", crypto.randomUUID());

  try {
    await runTransaction(db, async (transaction) => {
      // 1. Lire les données actuelles (Lecture atomique)
      const classDoc = await transaction.get(classRef);
      const userDoc = await transaction.get(userRef);

      if (!classDoc.exists() || !userDoc.exists()) {
        throw "Document introuvable !";
      }

      const classData = classDoc.data();
      const userData = userDoc.data();

      // 2. Vérifications de sécurité
      if (classData.attendeesCount >= classData.maxCapacity) {
        throw "Désolé, le cours est complet !";
      }

      if (userData.credits < cost) {
        throw "Crédits insuffisants. Rechargez votre compte !";
      }

      // 3. Écritures (Tout ou rien)
      
      // Mettre à jour le compteur du cours
      transaction.update(classRef, {
        attendeesCount: classData.attendeesCount + 1
      });

      // Débiter l'utilisateur
      transaction.update(userRef, {
        credits: userData.credits - cost
      });

      // Créer la réservation
      transaction.set(newBookingRef, {
        userId,
        classId,
        status: 'confirmed',
        bookedAt: serverTimestamp(),
        isLateCancel: false
      });

      // Créer l'historique de transaction
      transaction.set(newTransactionRef, {
        userId,
        type: 'usage',
        description: `Réservation : ${classData.title}`,
        amount: 0,
        creditsChange: -cost,
        date: serverTimestamp()
      });
    });

    console.log("Réservation réussie !");
    return { success: true };

  } catch (e) {
    console.error("Erreur réservation : ", e);
    return { success: false, error: e };
  }
}