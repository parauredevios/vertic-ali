import React, { useState, useEffect } from 'react';
import { 
  Calendar, User, MapPin, Plus, Trash2, Zap, Loader2, Edit2, AlertTriangle, ExternalLink,
  Phone, HeartPulse, Wallet, Home, CheckCircle, Clock, History, Users, Archive, ChevronDown, ChevronUp,
  Smartphone, Building, ShoppingBag, XCircle, UserPlus, Settings, Map
} from 'lucide-react';
import { db, auth } from './lib/firebase'; 
import { 
  collection, getDocs, addDoc, Timestamp, deleteDoc, doc, runTransaction, onSnapshot, setDoc, updateDoc, query, orderBy, where 
} from 'firebase/firestore';
import { 
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';

// --- CONFIGURATION ---
// ⚠️ COLLE TON URL GOOGLE SCRIPT ICI ⚠️
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzxqnW1O5bfVWLQpHuvXkouogYiUugO43jmEAB_QJMadCKfLFNpRXuf7XcZ6fg4ZGDG0w/exec"; 

// --- 1. MODÈLES & TYPES ---
interface StudioLocation { id: string; name: string; address: string; }
interface ClassTemplate { id: string; title: string; locationName: string; price: string; maxCapacity: number; description: string; }

interface DanceClass {
  id: string; title: string; description?: string; price: string;
  startAt: Date; endAt: Date; maxCapacity: number; attendeesCount: number;
  attendeeIds: string[]; instructor: string; location: string; locationAddress?: string;
}

interface UserProfile {
  id: string; credits: number; email: string; displayName: string; role: 'student' | 'admin';
  street?: string; zipCode?: string; city?: string; phone?: string; emergencyContact?: string; emergencyPhone?: string;
  hasFilledForm?: boolean; 
}

interface BookingInfo {
  id: string; classId: string; userId: string; userName: string; classTitle: string;
  date: string; dateStr: string; timeStr: string; location: string; price: string;
  paymentMethod: 'CREDIT' | 'CASH' | 'WERO_RIB'; paymentStatus: 'PAID' | 'PENDING';
}

type PaymentMethod = 'CREDIT' | 'CASH' | 'WERO_RIB';

// --- 2. FONCTION SYNC GOOGLE SHEETS ---
const syncToSheet = async (payload: any) => {
  if (GOOGLE_SCRIPT_URL.includes("TA_NOUVELLE_URL") || GOOGLE_SCRIPT_URL.includes("TA_URL_GOOGLE")) return; 
  try {
    const enrichedPayload = {
      ...payload,
      sheetName: payload.type === 'BOOKING' ? (payload.paymentStatus === 'PAID' ? 'Payer' : 'NON PAYÉ') : 'Defaut'
    };
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST", mode: "no-cors", 
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(enrichedPayload)
    });
  } catch (e) { console.error("Erreur Sync Sheets", e); }
};

const formatForInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// --- 3. MODALES ---

const PaymentInfoModal = ({ isOpen, onClose }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 text-left">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200">
        <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2"><Wallet className="text-amber-600"/> Moyens de paiement</h3>
        <p className="text-sm text-gray-600 mb-4">Tu peux régler ton cours dès maintenant via :</p>
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 space-y-4">
          <div>
            <span className="font-bold text-gray-800 flex items-center gap-2"><Smartphone size={16} className="text-blue-500"/> Wero - PayPal :</span>
            <p className="text-lg font-mono font-bold text-gray-700 mt-1 select-all">06 21 05 64 14</p>
          </div>
          <hr className="border-gray-200"/>
          <div>
            <span className="font-bold text-gray-800 flex items-center gap-2"><Building size={16} className="text-indigo-500"/> Virement :</span>
            <p className="text-sm font-mono font-bold text-gray-700 mt-1 break-all select-all">Bientôt dispo</p>
          </div>
        </div>
        <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-sm font-bold flex items-start gap-2 border border-amber-100">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p>Ajout obligatoire du motif :<br/><span className="text-amber-900 font-black">Nom prénom + date du cours</span></p>
        </div>
        <button onClick={onClose} className="mt-6 w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors">Fermer</button>
      </div>
    </div>
  );
};

const BookingSuccessModal = ({ isOpen, onClose }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 text-left">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-green-400 to-green-500"></div>
        <h3 className="text-2xl font-black text-gray-800 mb-2 flex items-center gap-2"><CheckCircle className="text-green-500" size={28}/> Réservé ! 🎉</h3>
        <p className="text-gray-600 mb-6 font-medium">Ta place est confirmée pour le cours.</p>
        <div className="bg-amber-50 rounded-xl p-4 mb-4 border border-amber-100">
          <h4 className="font-bold text-amber-900 mb-2 flex items-center gap-2"><ShoppingBag size={18}/> Matériel à prendre avec toi</h4>
          <p className="text-sm text-amber-800 mb-3">Pour ce cours, tu auras besoin des éléments suivants :</p>
          <ul className="text-sm text-amber-800 space-y-2 mb-5 list-disc pl-5 font-medium">
            <li>Short court + brassière <span className="font-normal opacity-80">(la peau doit accrocher !)</span></li>
            <li>Tapis de yoga <span className="font-normal opacity-80">(Si tu n'en as pas, merci de prévenir)</span></li>
            <li>Gourde d'eau</li>
          </ul>
          <h4 className="font-bold text-amber-900 mb-2 flex items-center gap-2"><AlertTriangle size={18}/> À noter :</h4>
          <ul className="text-sm text-amber-800 space-y-2 list-none font-medium">
            <li className="flex items-start gap-2"><XCircle size={16} className="text-red-500 shrink-0 mt-0.5"/> Retire tes bagues, bracelets et colliers avant le cours.</li>
            <li className="flex items-start gap-2"><XCircle size={16} className="text-red-500 shrink-0 mt-0.5"/> Ne mets <b>pas de crème/huile</b> sur le corps le jour même, tu risques de glisser !</li>
          </ul>
        </div>
        <button onClick={onClose} className="w-full py-3 bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition-colors shadow-lg shadow-green-200">J'ai compris, à vite !</button>
      </div>
    </div>
  );
};

const PaymentModal = ({ isOpen, onClose, onConfirm, userCredits }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 text-left">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2"><Wallet className="text-amber-600"/> Paiement</h3>
        <div className="space-y-3">
          <button onClick={() => onConfirm('CREDIT')} disabled={userCredits < 1} className={`w-full p-4 rounded-xl border-2 flex justify-between items-center ${userCredits >= 1 ? 'border-amber-100 bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-400'}`}>
            <div className="flex items-center gap-3"><Zap size={20}/> <span className="font-bold">1 Crédit</span></div>
            <span className="text-xs">Solde: {userCredits}</span>
          </button>
          <button onClick={() => onConfirm('CASH')} className="w-full p-4 rounded-xl border-2 border-gray-100 hover:bg-green-50 text-gray-700 flex gap-3"><span className="font-bold">Espèces (Sur place)</span></button>
          <button onClick={() => onConfirm('WERO_RIB')} className="w-full p-4 rounded-xl border-2 border-gray-100 hover:bg-blue-50 text-gray-700 flex gap-3"><span className="font-bold">Wero - PayPal</span></button>
        </div>
        <button onClick={onClose} className="mt-6 w-full py-3 text-gray-500 font-bold">Annuler</button>
      </div>
    </div>
  );
};

const UserProfileForm = ({ user, onClose }: any) => {
  const [formData, setFormData] = useState({
    street: user.street || '', zipCode: user.zipCode || '', city: user.city || '',
    phone: user.phone || '', emergencyContact: user.emergencyContact || '', emergencyPhone: user.emergencyPhone || ''
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.id), formData);
      await syncToSheet({ type: 'PROFILE', id: user.id, displayName: user.displayName, email: user.email, credits: user.credits, ...formData });
      alert("Profil enregistré ! ✅"); onClose();
    } catch (e) { alert("Erreur sauvegarde"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 text-left">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl h-[85vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2"><User className="text-amber-600"/> Mon Profil</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="bg-gray-50 p-3 rounded-xl mb-4 text-sm text-gray-500"><p><strong>{user.displayName}</strong></p><p>{user.email}</p></div>
          <div className="space-y-3">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><Phone size={16}/> Coordonnées</h3>
            <input placeholder="Téléphone" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full p-3 border rounded-xl" />
            <h3 className="font-bold text-gray-900 flex items-center gap-2 mt-4"><Home size={16}/> Adresse</h3>
            <input placeholder="Numéro et Rue" value={formData.street} onChange={e => setFormData({...formData, street: e.target.value})} className="w-full p-3 border rounded-xl" />
            <div className="flex gap-2">
              <input placeholder="Code Postal" value={formData.zipCode} onChange={e => setFormData({...formData, zipCode: e.target.value})} className="w-1/3 p-3 border rounded-xl" />
              <input placeholder="Ville" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-2/3 p-3 border rounded-xl" />
            </div>
          </div>
          <div className="space-y-3 mt-4 pt-4 border-t">
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><HeartPulse size={16} className="text-red-500"/> Urgence</h3>
            <input placeholder="Nom contact urgence" value={formData.emergencyContact} onChange={e => setFormData({...formData, emergencyContact: e.target.value})} className="w-full p-3 border rounded-xl" />
            <input placeholder="Tél contact urgence" value={formData.emergencyPhone} onChange={e => setFormData({...formData, emergencyPhone: e.target.value})} className="w-full p-3 border rounded-xl" />
          </div>
          <button type="submit" disabled={saving} className="w-full py-3 mt-6 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold rounded-xl shadow-lg hover:from-amber-600 hover:to-amber-700">{saving ? '...' : 'Enregistrer'}</button>
          <button type="button" onClick={onClose} className="w-full py-3 text-gray-500 font-bold">Annuler</button>
        </form>
      </div>
    </div>
  );
};

// --- 4. SOUS-COMPOSANTS ---

const AdminClassAttendees = ({ classInfo, onRefresh }: { classInfo: DanceClass, onRefresh: () => void }) => {
  const [bookings, setBookings] = useState<BookingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [showAddManual, setShowAddManual] = useState(false);
  const [newManualName, setNewManualName] = useState('');
  const [newManualMethod, setNewManualMethod] = useState<PaymentMethod>('CASH');

  useEffect(() => {
    const q = query(collection(db, "bookings"), where("classId", "==", classInfo.id));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() } as BookingInfo)));
      setLoading(false);
    });
    return () => unsub();
  }, [classInfo.id]);

  const togglePayment = async (bookingId: string, currentStatus: string, bookingData: any) => {
    const newStatus = currentStatus === 'PAID' ? 'PENDING' : 'PAID';
    await updateDoc(doc(db, "bookings", bookingId), { paymentStatus: newStatus });
    syncToSheet({
      type: 'BOOKING_UPDATE', classId: bookingData.classId, classTitle: bookingData.classTitle,
      date: bookingData.dateStr, time: bookingData.timeStr, location: bookingData.location || '',
      studentId: bookingData.userId, studentName: `${bookingData.userName} (${bookingData.paymentMethod})`,
      paymentStatus: newStatus, price: classInfo.price
    });
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newManualName) return;
    const manualId = 'manual_' + Date.now();
    try {
      await runTransaction(db, async (t) => {
        const classRef = doc(db, "classes", classInfo.id);
        const classDoc = await t.get(classRef);
        const cData = classDoc.data();
        if(!cData || cData.attendeesCount >= cData.maxCapacity) throw "Cours Complet";

        const currentAttendees = cData.attendeeIds || [];
        t.update(classRef, { attendeesCount: cData.attendeesCount + 1, attendeeIds: [...currentAttendees, manualId] });
        
        const dateStr = classInfo.startAt.toLocaleDateString('fr-FR');
        const timeStr = classInfo.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
        const paymentStatus = newManualMethod === 'CREDIT' ? 'PAID' : 'PENDING';

        t.set(doc(collection(db, "bookings")), { 
          classId: classInfo.id, userId: manualId, userName: newManualName + " (Manuel)",
          classTitle: classInfo.title, date: classInfo.startAt.toISOString(),
          dateStr, timeStr, location: classInfo.location, price: classInfo.price,
          paymentMethod: newManualMethod, paymentStatus
        });
      });

      syncToSheet({ 
        type: 'BOOKING', classId: classInfo.id, classTitle: classInfo.title, 
        date: classInfo.startAt.toLocaleDateString('fr-FR'), time: classInfo.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}), 
        location: classInfo.location, capacity: classInfo.maxCapacity, 
        studentId: manualId, studentName: `${newManualName} (Manuel) (${newManualMethod})`, 
        paymentStatus: newManualMethod === 'CREDIT' ? 'PAID' : 'PENDING', price: classInfo.price 
      });
      setNewManualName(''); setShowAddManual(false); onRefresh();
    } catch(e) { alert(e); }
  };

  const handleRemoveStudent = async (b: BookingInfo) => {
    if (!window.confirm(`Supprimer ${b.userName} de ce cours ?`)) return;
    try {
      await runTransaction(db, async (t) => {
        const classRef = doc(db, "classes", classInfo.id);
        const classDoc = await t.get(classRef);
        const cData = classDoc.data();
        if(!cData) return;

        if (b.paymentMethod === 'CREDIT' && !b.userId.startsWith('manual_')) {
          const userRef = doc(db, "users", b.userId);
          const userDoc = await t.get(userRef);
          if (userDoc.exists()) t.update(userRef, { credits: userDoc.data().credits + 1 });
        }

        const currentAttendees = cData.attendeeIds || [];
        t.update(classRef, { 
          attendeesCount: Math.max(0, cData.attendeesCount - 1), 
          attendeeIds: currentAttendees.filter((id: string) => id !== b.userId) 
        });
        t.delete(doc(db, "bookings", b.id));
      });

      syncToSheet({ 
        type: 'CANCEL', classId: classInfo.id, studentId: b.userId, classTitle: classInfo.title, 
        date: classInfo.startAt.toLocaleDateString('fr-FR'), time: classInfo.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}), 
        location: classInfo.location, studentName: `${b.userName} (${b.paymentMethod})`, price: classInfo.price,
        paymentStatus: b.paymentStatus // ENVOI DU STATUT DE PAIEMENT LORS DE L'ANNULATION
      });
      onRefresh();
    } catch(e) { alert("Erreur suppression"); }
  };

  if (loading) return <div className="p-4 text-center text-gray-400 text-sm">Chargement...</div>;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
      {bookings.length === 0 ? <div className="text-center text-gray-400 text-sm">Aucun inscrit.</div> : (
        <div className="space-y-2">
          {bookings.map(b => (
            <div key={b.id} className="flex justify-between items-center bg-gray-50 p-2.5 rounded-lg text-sm text-left border border-gray-100">
              <div className="flex-1">
                <span className="font-bold text-gray-700 block">{b.userName}</span>
                <span className="text-xs text-gray-500">{b.paymentMethod}</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => togglePayment(b.id, b.paymentStatus, b)}
                  disabled={b.paymentMethod === 'CREDIT'} 
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md font-bold transition-colors shrink-0 ${
                    b.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                  }`}
                >
                  {b.paymentStatus === 'PAID' ? <><CheckCircle size={14}/> Payé</> : <><Clock size={14}/> À régler</>}
                </button>
                <button onClick={() => handleRemoveStudent(b)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors" title="Supprimer cet élève">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-3 border-t border-gray-200 mt-3">
        {!showAddManual ? (
          <button type="button" onClick={() => setShowAddManual(true)} className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition-colors">
            <UserPlus size={16}/> Ajouter un élève manuellement
          </button>
        ) : (
          <form onSubmit={handleAddManual} className="flex flex-col gap-2 bg-gray-50 p-3 rounded-xl border border-gray-200">
            <p className="text-xs font-bold text-gray-500 flex items-center gap-1"><UserPlus size={14}/> Nouvel élève</p>
            <div className="flex gap-2">
              <input value={newManualName} onChange={e=>setNewManualName(e.target.value)} placeholder="Nom complet..." className="flex-1 text-sm p-2 border border-gray-300 rounded-lg outline-none focus:border-amber-500" />
              <select value={newManualMethod} onChange={e=>setNewManualMethod(e.target.value as PaymentMethod)} className="text-sm p-2 border border-gray-300 rounded-lg bg-white outline-none">
                <option value="CASH">Espèces</option>
                <option value="WERO_RIB">Virement</option>
                <option value="CREDIT">Crédit</option>
              </select>
            </div>
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => setShowAddManual(false)} className="flex-1 py-2 text-sm font-bold text-gray-500 bg-white border border-gray-200 rounded-lg">Annuler</button>
              <button type="submit" disabled={!newManualName || classInfo.attendeesCount >= classInfo.maxCapacity} className="flex-1 py-2 text-sm font-bold text-white bg-gray-800 rounded-lg disabled:opacity-50">Valider</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

const ClassCard = ({ info, onDelete, onEditClick, onBookClick, onCancelClick, processingId, userProfile, isBooked, onRefresh }: any) => {
  const [showAttendees, setShowAttendees] = useState(false);
  const isFull = info.attendeesCount >= info.maxCapacity;
  const isProcessing = processingId === info.id;
  const canBook = userProfile?.hasFilledForm;

  return (
    <div className={`bg-white p-5 rounded-2xl shadow-sm border relative flex flex-col justify-between text-left ${isBooked ? 'border-amber-400 ring-4 ring-amber-50' : 'border-gray-100 hover:shadow-md transition-shadow'}`}>
      
      {userProfile?.role === 'admin' && (
        <div className="absolute top-3 right-3 flex gap-2">
           <button onClick={() => onEditClick(info)} className="text-gray-300 hover:text-amber-500 transition-colors"><Edit2 size={18}/></button>
           <button onClick={() => { if(confirm("Supprimer ce cours ?")) onDelete(info.id); }} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
        </div>
      )}
      
      <div>
        <div className="flex justify-between items-start mb-4 gap-2">
          <div className="flex-1 pr-4">
            <h3 className="font-bold text-xl text-gray-800 leading-tight mb-1">{info.title}</h3>
            <p className="text-sm text-gray-500 capitalize">{info.startAt.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'})}</p>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <div className="text-xl font-black text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl whitespace-nowrap text-center">
              {info.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}
            </div>
            {info.price && <span className="text-sm font-bold text-gray-500 mt-1 bg-gray-100 px-2 py-0.5 rounded-md">Tarif : {info.price}</span>}
          </div>
        </div>
        
        <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-md mb-3 inline-block">Prof : {info.instructor}</span>
        {info.description && <p className="text-sm text-gray-600 mb-4 bg-gray-50 p-3 rounded-xl border border-gray-100 whitespace-pre-wrap">{info.description}</p>}
        
        <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-6 font-medium">
          <span className={`flex gap-1.5 items-center ${isFull && !isBooked ? 'text-red-500' : ''}`}><User size={16}/> {info.attendeesCount}/{info.maxCapacity}</span>
          <a href={`https://www.google.com/maps/search/?api=1&query=$${encodeURIComponent(info.locationAddress || info.location)}`} target="_blank" rel="noopener noreferrer" className="flex gap-1.5 items-center hover:text-amber-600 underline transition-colors" title="Ouvrir le GPS">
            <MapPin size={16}/> {info.location}
          </a>
        </div>
      </div>

      {isBooked ? (
        <button onClick={() => onCancelClick(info.id)} disabled={isProcessing} className="w-full py-3.5 rounded-xl font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors">
          {isProcessing ? '...' : 'Annuler ma réservation'}
        </button>
      ) : (
        <button 
          onClick={() => onBookClick(info.id)} 
          disabled={!canBook || isFull || isProcessing || info.endAt < new Date()} 
          className={`w-full py-3.5 rounded-xl font-bold text-white transition-all 
            ${!canBook || isFull || info.endAt < new Date() ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-200'}
          `}
        >
          {isProcessing ? '...' : info.endAt < new Date() ? 'Terminé' : !canBook ? 'Fiche requise' : isFull ? 'Cours Complet' : 'Réserver ma place'}
        </button>
      )}

      {userProfile?.role === 'admin' && (
        <div className="mt-4">
          <button onClick={() => setShowAttendees(!showAttendees)} className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-amber-700 bg-amber-50 rounded-xl hover:bg-amber-100 transition-colors">
            <Users size={16}/> {showAttendees ? 'Masquer les inscrits' : 'Voir les inscrits'} {showAttendees ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
          </button>
          {showAttendees && <AdminClassAttendees classInfo={info} onRefresh={onRefresh} />}
        </div>
      )}
    </div>
  );
};

const AdminClassForm = ({ onAdd, locations, templates, editClassData, onCancelEdit }: { onAdd: () => void, locations: StudioLocation[], templates: ClassTemplate[], editClassData: DanceClass | null, onCancelEdit: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState({title: '', date: '', desc: '', cap: 12, loc: '', price: ''});
  
  useEffect(() => {
    if (editClassData) {
      setData({ title: editClassData.title, date: formatForInput(editClassData.startAt), desc: editClassData.description || '', cap: editClassData.maxCapacity, loc: editClassData.location, price: editClassData.price || '' });
      setIsOpen(true);
    } else {
      if(!data.loc && locations.length > 0) setData(prev => ({...prev, loc: locations[0].name}));
    }
  }, [editClassData, locations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!data.date || !data.title) return;
    try {
      const start = new Date(data.date);
      const locObj = locations.find(l => l.name === data.loc);
      const payload = {
        title: data.title, description: data.desc, instructor: "Ali", 
        location: data.loc, locationAddress: locObj ? locObj.address : '', price: data.price,
        startAt: Timestamp.fromDate(start), endAt: Timestamp.fromDate(new Date(start.getTime() + 90*60000)),
        maxCapacity: Number(data.cap)
      };

      if (editClassData) await updateDoc(doc(db, "classes", editClassData.id), payload);
      else await addDoc(collection(db, "classes"), { ...payload, attendeesCount: 0, attendeeIds: [] });
      
      setIsOpen(false); onCancelEdit(); onAdd();
    } catch (e) { alert("Erreur"); }
  };
  
  const handleClose = () => { setIsOpen(false); onCancelEdit(); };

  if (!isOpen && !editClassData) return <button onClick={() => setIsOpen(true)} className="w-full mb-8 border-2 border-dashed border-amber-300 text-amber-700 py-4 rounded-xl flex justify-center items-center gap-2 font-bold hover:bg-amber-50 transition-colors"><Plus/> Créer un nouveau cours</button>;

  return (
    <div className="bg-white p-6 rounded-2xl mb-8 border border-amber-100 shadow-sm relative text-left">
      <h3 className="font-bold text-amber-800 mb-4 text-lg">{editClassData ? 'Modifier le cours' : 'Nouveau Cours'}</h3>
      
      {!editClassData && templates.length > 0 && (
        <select 
          className="w-full mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl font-bold text-amber-900 outline-none"
          onChange={(e) => {
            const t = templates.find(x => x.id === e.target.value);
            if (t) setData({...data, title: t.title, loc: t.locationName, cap: t.maxCapacity, desc: t.description, price: t.price });
          }}
        >
          <option value="">-- Charger un modèle pré-enregistré --</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <input value={data.title} onChange={e=>setData({...data, title: e.target.value})} className="w-full p-3 border rounded-xl" placeholder="Titre du cours *"/>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <input type="datetime-local" value={data.date} onChange={e=>setData({...data, date: e.target.value})} className="w-full p-3 border rounded-xl"/>
          <select value={data.loc} onChange={e=>setData({...data, loc: e.target.value})} className="w-full p-3 border rounded-xl bg-white">
            {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
          <input type="text" value={data.price} onChange={e=>setData({...data, price: e.target.value})} className="w-full p-3 border rounded-xl" placeholder="Tarif (ex: 15€ ou 1 Crédit)"/>
          <div className="flex items-center gap-2 bg-gray-50 px-3 rounded-xl border">
            <span className="text-sm text-gray-500 whitespace-nowrap font-medium">Places:</span>
            <input type="number" value={data.cap} onChange={e=>setData({...data, cap: Number(e.target.value)})} className="w-full bg-transparent py-3 outline-none"/>
          </div>
        </div>
        <textarea value={data.desc} onChange={e=>setData({...data, desc: e.target.value})} className="w-full p-3 border rounded-xl min-h-[100px]" placeholder="Description (Tenue, Niveau...)"/>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={handleClose} className="flex-1 py-3 bg-gray-100 rounded-xl text-gray-600 font-bold hover:bg-gray-200">Annuler</button>
          <button type="submit" className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-xl font-bold">{editClassData ? 'Mettre à jour' : 'Valider'}</button>
        </div>
      </form>
    </div>
  );
};

const AdminSettingsTab = ({ locations, templates }: { locations: StudioLocation[], templates: ClassTemplate[] }) => {
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddress, setNewLocAddress] = useState('');
  const [newTpl, setNewTpl] = useState({ title: '', loc: locations[0]?.name || '', price: '', cap: 12, desc: '' });

  const addLocation = async () => {
    if (!newLocName) return;
    const newLoc = { id: Date.now().toString(), name: newLocName, address: newLocAddress };
    await setDoc(doc(db, "settings", "general"), { locations: [...locations, newLoc] }, { merge: true });
    setNewLocName(''); setNewLocAddress('');
  };
  const removeLocation = async (id: string) => {
    if(!confirm("Supprimer ce lieu ?")) return;
    await setDoc(doc(db, "settings", "general"), { locations: locations.filter(l => l.id !== id) }, { merge: true });
  };

  const addTemplate = async (e: React.FormEvent) => {
    e.preventDefault(); if (!newTpl.title) return;
    const newT = { id: Date.now().toString(), title: newTpl.title, locationName: newTpl.loc, price: newTpl.price, maxCapacity: Number(newTpl.cap), description: newTpl.desc };
    await setDoc(doc(db, "settings", "general"), { templates: [...templates, newT] }, { merge: true });
    setNewTpl({ title: '', loc: locations[0]?.name || '', price: '', cap: 12, desc: '' });
  };
  const removeTemplate = async (id: string) => {
    if(!confirm("Supprimer ce modèle ?")) return;
    await setDoc(doc(db, "settings", "general"), { templates: templates.filter(t => t.id !== id) }, { merge: true });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><Map className="text-indigo-500"/> Gestion des Lieux</h3>
        <div className="flex flex-col gap-2 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
          <input value={newLocName} onChange={e=>setNewLocName(e.target.value)} placeholder="Nom du lieu (ex: Studio A)" className="p-2 border rounded-lg text-sm outline-none"/>
          <input value={newLocAddress} onChange={e=>setNewLocAddress(e.target.value)} placeholder="Adresse complète (pour le GPS)" className="p-2 border rounded-lg text-sm outline-none"/>
          <button onClick={addLocation} className="bg-indigo-600 text-white font-bold py-2 rounded-lg hover:bg-indigo-700">Ajouter le lieu</button>
        </div>
        <div className="space-y-2">
          {locations.map(l => (
            <div key={l.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
              <div><p className="font-bold text-sm text-gray-800">{l.name}</p><p className="text-xs text-gray-500 truncate max-w-[200px]">{l.address}</p></div>
              <button onClick={() => removeLocation(l.id)} className="text-red-500 p-2 hover:bg-red-50 rounded-md"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><Plus className="text-amber-500"/> Modèles de cours</h3>
        <form onSubmit={addTemplate} className="flex flex-col gap-2 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
          <input value={newTpl.title} onChange={e=>setNewTpl({...newTpl, title: e.target.value})} placeholder="Titre du modèle" className="p-2 border rounded-lg text-sm outline-none"/>
          <div className="grid grid-cols-2 gap-2">
            <select value={newTpl.loc} onChange={e=>setNewTpl({...newTpl, loc: e.target.value})} className="p-2 border rounded-lg text-sm outline-none bg-white">
              {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
            <input value={newTpl.price} onChange={e=>setNewTpl({...newTpl, price: e.target.value})} placeholder="Tarif" className="p-2 border rounded-lg text-sm outline-none"/>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-gray-500 whitespace-nowrap bg-white px-2 py-2 border rounded-lg">Capacité:</span>
            <input type="number" value={newTpl.cap} onChange={e=>setNewTpl({...newTpl, cap: Number(e.target.value)})} className="p-2 border rounded-lg text-sm w-full outline-none"/>
          </div>
          <textarea value={newTpl.desc} onChange={e=>setNewTpl({...newTpl, desc: e.target.value})} placeholder="Description par défaut..." className="p-2 border rounded-lg text-sm outline-none min-h-[60px]"/>
          <button type="submit" className="bg-amber-600 text-white font-bold py-2 rounded-lg hover:bg-amber-700">Créer le modèle</button>
        </form>
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
              <div>
                <p className="font-bold text-sm text-gray-800">{t.title}</p>
                <p className="text-xs text-gray-500">{t.locationName} • {t.price} • {t.maxCapacity} pl.</p>
              </div>
              <button onClick={() => removeTemplate(t.id)} className="text-red-500 p-2 hover:bg-red-50 rounded-md"><Trash2 size={16}/></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- 5. APPLICATION PRINCIPALE ---
export default function App() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'planning' | 'history' | 'admin_students' | 'admin_past' | 'admin_settings'>('planning');
  const [classes, setClasses] = useState<DanceClass[]>([]);
  const [pastClasses, setPastClasses] = useState<DanceClass[]>([]);
  const [locations, setLocations] = useState<StudioLocation[]>([]);
  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [myBookings, setMyBookings] = useState<BookingInfo[]>([]);
  
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  
  const [paymentModal, setPaymentModal] = useState<{isOpen: boolean, classId: string | null}>({isOpen: false, classId: null});
  const [isPaymentInfoOpen, setPaymentInfoOpen] = useState(false);
  const [isBookingSuccessOpen, setBookingSuccessOpen] = useState(false);
  
  const [editingClass, setEditingClass] = useState<DanceClass | null>(null);
  const hasPendingPayments = myBookings.some(b => b.paymentStatus === 'PENDING');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (user) {
        onSnapshot(doc(db, "users", user.uid), (snap) => {
          if (snap.exists()) setUserProfile({ id: snap.id, ...snap.data() } as UserProfile);
          else {
            const newUser = { email: user.email, displayName: user.displayName, credits: 0, role: 'student', hasFilledForm: false };
            setDoc(doc(db, "users", user.uid), newUser);
            syncToSheet({ type: 'PROFILE', id: user.uid, ...newUser });
          }
        });
      } else setUserProfile(null);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const fetchAllData = async () => {
    const snap = await getDocs(query(collection(db, "classes"), orderBy("startAt", "asc")));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data(), attendeeIds: d.data().attendeeIds || [], startAt: d.data().startAt?.toDate(), endAt: d.data().endAt?.toDate() } as DanceClass));
    const now = new Date();
    setClasses(all.filter(c => c.endAt && c.endAt > now));
    setPastClasses(all.filter(c => c.endAt && c.endAt <= now).reverse()); 
  };

  useEffect(() => {
    fetchAllData();
    onSnapshot(doc(db, "settings", "general"), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.locations && data.locations.length > 0 && typeof data.locations[0] === 'string') {
          setLocations(data.locations.map((l: string, i: number) => ({ id: i.toString(), name: l, address: '' })));
        } else {
          setLocations(data.locations || []);
        }
        setTemplates(data.templates || []);
      } else {
        setDoc(doc(db, "settings", "general"), { locations: [], templates: [] });
      }
    });
  }, []);

  useEffect(() => {
    if (userProfile) {
      const q = query(collection(db, "bookings"), where("userId", "==", userProfile.id));
      const unsub = onSnapshot(q, (snap) => {
        const books = snap.docs.map(d => ({ id: d.id, ...d.data() } as BookingInfo));
        setMyBookings(books.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      });
      return () => unsub();
    }
  }, [userProfile]);

  const handleValidateForm = async () => {
    if (!userProfile) return;
    await updateDoc(doc(db, "users", userProfile.id), { hasFilledForm: true });
    alert("Merci ! Tu peux maintenant réserver des cours.");
  };

  const initiateBooking = (classId: string) => setPaymentModal({ isOpen: true, classId });
  const confirmBooking = async (method: PaymentMethod) => {
    const classId = paymentModal.classId;
    if (!classId || !userProfile) return;
    setPaymentModal({ isOpen: false, classId: null }); setProcessingId(classId);

    try {
      await runTransaction(db, async (t) => {
        const classRef = doc(db, "classes", classId);
        const userRef = doc(db, "users", userProfile.id);
        const classDoc = await t.get(classRef); 
        const userDoc = await t.get(userRef);
        
        const classData = classDoc.data(); const userData = userDoc.data();
        if (!classData || !userData) throw "Données introuvables";

        const currentAttendees = classData.attendeeIds || [];
        if (currentAttendees.includes(userProfile.id)) throw "Déjà inscrit !";
        if (classData.attendeesCount >= classData.maxCapacity) throw "Complet !";
        if (method === 'CREDIT' && userData.credits < 1) throw "Crédit insuffisant";

        if (method === 'CREDIT') t.update(userRef, { credits: userData.credits - 1 });
        t.update(classRef, { attendeesCount: classData.attendeesCount + 1, attendeeIds: [...currentAttendees, userProfile.id] });
        
        const paymentStatus = method === 'CREDIT' ? 'PAID' : 'PENDING';
        const dateStr = classData.startAt.toDate().toLocaleDateString('fr-FR');
        const timeStr = classData.startAt.toDate().toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});

        t.set(doc(collection(db, "bookings")), { 
          classId, userId: userProfile.id, userName: userProfile.displayName,
          classTitle: classData.title, date: classData.startAt.toDate().toISOString(),
          dateStr, timeStr, location: classData.location, price: classData.price || '',
          paymentMethod: method, paymentStatus
        });
        return { title: classData.title, dateStr, timeStr, loc: classData.location, cap: classData.maxCapacity, paymentStatus, method, price: classData.price || '' };
      }).then((d) => {
        syncToSheet({ type: 'BOOKING', classId, classTitle: d.title, date: d.dateStr, time: d.timeStr, location: d.loc, capacity: d.cap, studentId: userProfile.id, studentName: `${userProfile.displayName} (${d.method})`, paymentStatus: d.paymentStatus, price: d.price });
        setBookingSuccessOpen(true); 
        fetchAllData();
      });
    } catch (e) { alert("Erreur: " + e); }
    setProcessingId(null);
  };

  const handleCancel = async (classId: string) => {
    if (!userProfile || !window.confirm("Annuler ta réservation ?")) return;
    setProcessingId(classId);
    try {
      const q = query(collection(db, "bookings"), where("classId", "==", classId), where("userId", "==", userProfile.id));
      const snap = await getDocs(q);
      let method = 'CASH'; let bookingId = null; let pStatus = 'PENDING';
      if (!snap.empty) { 
        bookingId = snap.docs[0].id; 
        method = snap.docs[0].data().paymentMethod; 
        pStatus = snap.docs[0].data().paymentStatus;
      }

      await runTransaction(db, async (t) => {
        const classRef = doc(db, "classes", classId); const userRef = doc(db, "users", userProfile.id);
        const classDoc = await t.get(classRef); const userDoc = await t.get(userRef);
        const classData = classDoc.data(); const userData = userDoc.data();
        
        if (!classData || !userData) throw "Données introuvables";
        const currentAttendees = classData.attendeeIds || [];
        
        if (method === 'CREDIT') t.update(userRef, { credits: userData.credits + 1 });
        t.update(classRef, { attendeesCount: classData.attendeesCount - 1, attendeeIds: currentAttendees.filter((id: string) => id !== userProfile.id) });
        if (bookingId) t.delete(doc(db, "bookings", bookingId));
      });

      const cTarget = classes.find(c => c.id === classId) || pastClasses.find(c => c.id === classId);
      if(cTarget) {
         syncToSheet({ 
           type: 'CANCEL', classId, studentId: userProfile.id, classTitle: cTarget.title, 
           date: cTarget.startAt.toLocaleDateString('fr-FR'), time: cTarget.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}), 
           location: cTarget.location, studentName: `${userProfile.displayName} (${method})`, price: cTarget.price || '',
           paymentStatus: pStatus // ENVOI DU STATUT DE PAIEMENT LORS DE L'ANNULATION
         });
      }
      alert("Réservation annulée !"); fetchAllData();
    } catch (e) { alert("Erreur: " + e); }
    setProcessingId(null);
  };

  if (authLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-amber-600"/></div>;
  if (!authUser) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center">
        <div className="bg-white p-2 rounded-full shadow-sm mb-4 inline-block">
            <img src="/logo.png" alt="Logo Vertic'Ali" className="w-40 h-40 object-contain mx-auto" onError={(e) => { e.currentTarget.src = "https://ui-avatars.com/api/?name=Vertic+Ali&background=d4af37&color=000&size=128" }}/>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Vertic'Ali</h1>
        <p className="text-gray-500 mb-8">Réserve tes cours en un clic.</p>
        <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-3">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" /> Connexion Google
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans pb-32 text-left w-full">
      <div className="w-full max-w-[1500px] mx-auto">
        
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
             {authUser?.photoURL && <img src={authUser.photoURL} className="w-14 h-14 rounded-full border-2 border-amber-200 shadow-sm"/>}
             <div>
               <h1 className="text-xl font-bold text-gray-900 leading-tight">Bonjour {authUser?.displayName?.split(' ')[0]}</h1>
               <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm mt-2">
                 <button onClick={() => setPaymentInfoOpen(true)} className={`font-bold px-4 py-1.5 rounded-lg transition-all border-2 ${hasPendingPayments ? 'bg-red-50 text-red-600 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] animate-pulse' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
                   Moyens de paiement
                 </button>
                 <span className="text-gray-300 hidden sm:inline">•</span>
                 <button onClick={() => setShowProfile(true)} className="text-gray-500 hover:text-amber-600 font-medium">Mon Profil</button>
                 <span className="text-gray-300 hidden sm:inline">•</span>
                 <button onClick={() => signOut(auth)} className="text-gray-500 hover:text-red-500">Déconnexion</button>
               </div>
             </div>
          </div>
          <div className="px-5 py-3 bg-white border-2 border-amber-100 rounded-2xl shadow-sm text-xl font-black text-amber-700 flex items-center gap-2 self-start sm:self-auto">
            <Zap size={22} className="fill-amber-600" /> {userProfile?.credits ?? 0}
          </div>
        </header>

        {userProfile && !userProfile.hasFilledForm && (
          <div className="bg-red-50 border-2 border-red-200 p-5 rounded-2xl mb-8 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-4 text-red-700 font-medium text-base">
               <AlertTriangle size={28} className="shrink-0" />
               <p>Tu dois obligatoirement remplir la <b>fiche d'inscription (santé & droit à l'image)</b> pour pouvoir réserver un cours.</p>
            </div>
            <div className="flex gap-3 w-full md:w-auto">
               <a href="https://docs.google.com/forms/d/e/1FAIpQLScFB9AwnG5svoixfNDer61h98heVkQP5bRPGww8x05XcNy9HQ/viewform" target="_blank" rel="noreferrer" className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition-colors">
                  <ExternalLink size={16}/> Ouvrir le formulaire
               </a>
               <button onClick={handleValidateForm} className="flex-1 md:flex-none px-5 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-green-200">
                  C'est fait !
               </button>
            </div>
          </div>
        )}

        <nav className="flex overflow-x-auto hide-scrollbar gap-2 mb-8 bg-white p-2 rounded-2xl shadow-sm border border-gray-100">
          <button onClick={() => setActiveTab('planning')} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold whitespace-nowrap transition-colors ${activeTab === 'planning' ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-50'}`}>
            <Calendar size={18}/> Planning
          </button>
          <button onClick={() => setActiveTab('history')} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold whitespace-nowrap transition-colors ${activeTab === 'history' ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-50'}`}>
            <History size={18}/> Mon Historique
          </button>
          
          {userProfile?.role === 'admin' && (
            <>
              <div className="w-px bg-gray-200 my-2 mx-2"></div>
              <button onClick={() => setActiveTab('admin_students')} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold whitespace-nowrap transition-colors ${activeTab === 'admin_students' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                <Users size={18}/> Tous les Élèves
              </button>
              <button onClick={() => setActiveTab('admin_past')} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold whitespace-nowrap transition-colors ${activeTab === 'admin_past' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                <Archive size={18}/> Cours Passés
              </button>
              <button onClick={() => setActiveTab('admin_settings')} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold whitespace-nowrap transition-colors ${activeTab === 'admin_settings' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                <Settings size={18}/> Réglages
              </button>
            </>
          )}
        </nav>

        {activeTab === 'planning' && (
          <div>
            {userProfile?.role === 'admin' && <AdminClassForm onAdd={fetchAllData} locations={locations} templates={templates} editClassData={editingClass} onCancelEdit={() => setEditingClass(null)} />}
            {classes.length === 0 ? ( <div className="bg-white rounded-2xl p-10 text-center text-gray-400">Aucun cours à venir.</div> ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 items-start">
                {classes.map(c => <ClassCard key={c.id} info={c} onDelete={async(id:string)=>{await deleteDoc(doc(db,"classes",id)); fetchAllData()}} onEditClick={setEditingClass} onBookClick={initiateBooking} onCancelClick={handleCancel} processingId={processingId} userProfile={userProfile} isBooked={c.attendeeIds?.includes(userProfile?.id || '')} onRefresh={fetchAllData} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-3xl text-left">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><History className="text-amber-600"/> Mon Historique</h2>
            {myBookings.length === 0 ? <p className="text-gray-500">Aucun cours réservé pour le moment.</p> : (
              <div className="space-y-4">
                {myBookings.map(b => (
                  <div key={b.id} className="flex justify-between items-center p-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-white transition-colors">
                    <div>
                      <h3 className="font-bold text-gray-800">{b.classTitle}</h3>
                      <p className="text-sm text-gray-500 capitalize">{new Date(b.date).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'})}</p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      {b.price && <span className="text-xs font-bold text-gray-400">Tarif: {b.price}</span>}
                      <span className="text-xs font-bold text-gray-500">Via {b.paymentMethod}</span>
                      <span className={`text-xs font-bold px-2 py-1 rounded-md ${b.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {b.paymentStatus === 'PAID' ? 'Payé' : 'À régler'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'admin_students' && userProfile?.role === 'admin' && (
          <AdminStudentsTab />
        )}

        {activeTab === 'admin_past' && userProfile?.role === 'admin' && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><Archive className="text-gray-600"/> Archives des cours terminés</h2>
            {pastClasses.length === 0 ? <p className="text-gray-500">Aucun cours terminé.</p> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 opacity-75 items-start">
                {pastClasses.map(c => <ClassCard key={c.id} info={c} onDelete={async(id:string)=>{await deleteDoc(doc(db,"classes",id)); fetchAllData()}} processingId={null} userProfile={userProfile} isBooked={false} onBookClick={()=>{}} onCancelClick={()=>{}} onRefresh={fetchAllData} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'admin_settings' && userProfile?.role === 'admin' && (
          <AdminSettingsTab locations={locations} templates={templates} />
        )}

      </div>

      {showProfile && userProfile && <UserProfileForm user={userProfile} onClose={() => setShowProfile(false)}/>}
      <PaymentModal isOpen={paymentModal.isOpen} onClose={() => setPaymentModal({isOpen:false, classId:null})} onConfirm={confirmBooking} userCredits={userProfile?.credits || 0}/>
      <PaymentInfoModal isOpen={isPaymentInfoOpen} onClose={() => setPaymentInfoOpen(false)} />
      <BookingSuccessModal isOpen={isBookingSuccessOpen} onClose={() => setBookingSuccessOpen(false)} />
    </div>
  );
}

const AdminStudentsTab = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userBookings, setUserBookings] = useState<BookingInfo[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "users")), (snap) => setUsers(snap.docs.map(d => ({id: d.id, ...d.data()} as UserProfile))));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      const unsub = onSnapshot(query(collection(db, "bookings"), where("userId", "==", selectedUserId)), (snap) => {
        const books = snap.docs.map(d => ({id: d.id, ...d.data()} as BookingInfo));
        setUserBookings(books.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      });
      return () => unsub();
    }
  }, [selectedUserId]);

  const handleUpdateCredit = async (userId: string, newAmount: number) => await updateDoc(doc(db, "users", userId), { credits: newAmount });

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start text-left">
      <div className="bg-white border-2 border-gray-800 rounded-2xl p-4 w-full lg:w-1/3">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Users size={18}/> Liste des élèves</h3>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
          {users.map(u => (
            <div key={u.id} className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-colors ${selectedUserId === u.id ? 'border-gray-800 bg-gray-50' : 'border-gray-100 hover:border-gray-300'}`} onClick={() => setSelectedUserId(u.id)}>
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-sm text-gray-800">{u.displayName}</span>
                {!u.hasFilledForm && (
                  <span title="Fiche non remplie">
                    <AlertTriangle size={14} className="text-red-500" />
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500 mb-2">{u.email}</span>
              <div className="flex gap-2 items-center">
                <button onClick={(e) => { e.stopPropagation(); handleUpdateCredit(u.id, u.credits-1)}} className="w-6 h-6 bg-gray-200 rounded text-xs font-bold">-</button>
                <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">{u.credits} cr</span>
                <button onClick={(e) => { e.stopPropagation(); handleUpdateCredit(u.id, u.credits+1)}} className="w-6 h-6 bg-amber-200 text-amber-800 rounded text-xs font-bold">+</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-6 w-full lg:w-2/3 min-h-[50vh]">
        {!selectedUserId ? (
          <div className="h-full flex items-center justify-center text-gray-400">Sélectionnez un élève à gauche.</div>
        ) : (
          <>
            <h3 className="font-bold text-xl text-gray-800 mb-6 flex items-center gap-2">Historique des réservations</h3>
            {userBookings.length === 0 ? <p className="text-gray-500">Aucun historique pour cet élève.</p> : (
              <div className="space-y-3">
                {userBookings.map(b => (
                  <div key={b.id} className="flex justify-between items-center p-3 rounded-lg border border-gray-100 bg-gray-50">
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm">{b.classTitle}</h4>
                      <p className="text-xs text-gray-500">{new Date(b.date).toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'})} à {new Date(b.date).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</p>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <span className="text-xs font-bold text-gray-500">{b.paymentMethod}</span>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded mt-1 uppercase ${b.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                        {b.paymentStatus === 'PAID' ? 'Payé' : 'À régler'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
