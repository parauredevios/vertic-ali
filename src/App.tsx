import React, { useState, useEffect } from 'react';
import { 
  Calendar, User, MapPin, Plus, Trash2, Zap, Loader2, Edit2, AlertTriangle, ExternalLink,
  Settings, Phone, HeartPulse, Wallet, X, Home, CheckCircle, Clock, History, Users, Archive, ChevronDown, ChevronUp,
  Smartphone, Building, ShoppingBag, XCircle
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
interface DanceClass {
  id: string; title: string; description?: string;
  startAt: Date; endAt: Date; maxCapacity: number; attendeesCount: number;
  attendeeIds: string[]; instructor: string; location: string;
}

interface UserProfile {
  id: string; credits: number; email: string; displayName: string; role: 'student' | 'admin';
  street?: string; zipCode?: string; city?: string; phone?: string; emergencyContact?: string; emergencyPhone?: string;
  hasFilledForm?: boolean; 
}

interface BookingInfo {
  id: string; classId: string; userId: string; userName: string; classTitle: string;
  date: string; dateStr: string; timeStr: string; location: string;
  paymentMethod: 'CREDIT' | 'CASH' | 'WERO_RIB'; paymentStatus: 'PAID' | 'PENDING';
}

type PaymentMethod = 'CREDIT' | 'CASH' | 'WERO_RIB';

// --- 2. FONCTION SYNC GOOGLE SHEETS ---
const syncToSheet = async (payload: any) => {
  if (GOOGLE_SCRIPT_URL.includes("TA_NOUVELLE_URL")) return; 
  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST", mode: "no-cors", 
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
  } catch (e) { console.error("Erreur Sync Sheets", e); }
};

const formatForInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// --- 3. MODALES ---

const PaymentInfoModal = ({ isOpen, onClose }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200">
        <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2"><Wallet className="text-amber-600"/> Moyens de paiement</h3>
        <p className="text-sm text-gray-600 mb-4">Tu peux régler ton cours dès maintenant via :</p>

        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 space-y-4">
          <div>
            <span className="font-bold text-gray-800 flex items-center gap-2"><Smartphone size={16} className="text-blue-500"/> Wero (gratuit et instantané) :</span>
            <p className="text-lg font-mono font-bold text-gray-700 mt-1 select-all">06********</p>
          </div>
          <hr className="border-gray-200"/>
          <div>
            <span className="font-bold text-gray-800 flex items-center gap-2"><Building size={16} className="text-indigo-500"/> Virement :</span>
            <p className="text-sm font-mono font-bold text-gray-700 mt-1 break-all select-all">FR212***************************</p>
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2"><Wallet className="text-amber-600"/> Paiement</h3>
        <div className="space-y-3">
          <button onClick={() => onConfirm('CREDIT')} disabled={userCredits < 1} className={`w-full p-4 rounded-xl border-2 flex justify-between items-center ${userCredits >= 1 ? 'border-amber-100 bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-400'}`}>
            <div className="flex items-center gap-3"><Zap size={20}/> <span className="font-bold">1 Crédit</span></div>
            <span className="text-xs">Solde: {userCredits}</span>
          </button>
          <button onClick={() => onConfirm('CASH')} className="w-full p-4 rounded-xl border-2 border-gray-100 hover:bg-green-50 text-gray-700 flex gap-3"><span className="font-bold">Espèces (Sur place)</span></button>
          <button onClick={() => onConfirm('WERO_RIB')} className="w-full p-4 rounded-xl border-2 border-gray-100 hover:bg-blue-50 text-gray-700 flex gap-3"><span className="font-bold">Virement / Wero</span></button>
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
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

const AdminClassAttendees = ({ classId }: { classId: string }) => {
  const [bookings, setBookings] = useState<BookingInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "bookings"), where("classId", "==", classId));
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() } as BookingInfo)));
      setLoading(false);
    });
    return () => unsub();
  }, [classId]);

  const togglePayment = async (bookingId: string, currentStatus: string, bookingData: any) => {
    const newStatus = currentStatus === 'PAID' ? 'PENDING' : 'PAID';
    await updateDoc(doc(db, "bookings", bookingId), { paymentStatus: newStatus });
    
    // Synchro avec Google Sheets : Déplace vers le bon onglet
    syncToSheet({
      type: 'BOOKING_UPDATE',
      classId: bookingData.classId,
      classTitle: bookingData.classTitle,
      date: bookingData.dateStr,
      time: bookingData.timeStr,
      location: bookingData.location || '',
      studentId: bookingData.userId,
      studentName: `${bookingData.userName} (${bookingData.paymentMethod})`,
      paymentStatus: newStatus
    });
  };

  if (loading) return <div className="p-4 text-center text-gray-400 text-sm">Chargement...</div>;
  if (bookings.length === 0) return <div className="p-4 text-center text-gray-400 text-sm border-t border-gray-100">Aucun inscrit pour le moment.</div>;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
      <h4 className="text-sm font-bold text-gray-800 mb-2">Élèves inscrits :</h4>
      {bookings.map(b => (
        <div key={b.id} className="flex justify-between items-center bg-gray-50 p-2.5 rounded-lg text-sm">
          <div>
            <span className="font-bold text-gray-700 block">{b.userName}</span>
            <span className="text-xs text-gray-500">{b.paymentMethod}</span>
          </div>
          <button 
            onClick={() => togglePayment(b.id, b.paymentStatus, b)}
            disabled={b.paymentMethod === 'CREDIT'} 
            className={`flex items-center gap-1 px-3 py-1.5 rounded-md font-bold transition-colors ${
              b.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
            }`}
          >
            {b.paymentStatus === 'PAID' ? <><CheckCircle size={14}/> Payé</> : <><Clock size={14}/> À régler</>}
          </button>
        </div>
      ))}
    </div>
  );
};

const ClassCard = ({ info, onDelete, onEditClick, onBookClick, onCancelClick, processingId, userProfile, isBooked }: any) => {
  const [showAttendees, setShowAttendees] = useState(false);
  const isFull = info.attendeesCount >= info.maxCapacity;
  const isProcessing = processingId === info.id;
  const canBook = userProfile?.hasFilledForm;

  return (
    <div className={`bg-white p-5 rounded-2xl shadow-sm border relative flex flex-col justify-between ${isBooked ? 'border-amber-300 ring-2 ring-amber-50' : 'border-gray-100 hover:shadow-md transition-shadow'}`}>
      
      {/* Menu d'édition Admin */}
      {userProfile?.role === 'admin' && (
        <div className="absolute top-3 right-3 flex gap-2">
           <button onClick={() => onEditClick(info)} className="text-gray-300 hover:text-amber-500 transition-colors"><Edit2 size={18}/></button>
           <button onClick={() => { if(confirm("Supprimer ce cours ?")) onDelete(info.id); }} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
        </div>
      )}
      
      <div>
        <div className="flex justify-between items-start mb-3">
          <div className="pr-16">
            <h3 className="font-bold text-lg text-gray-800 leading-tight mb-1">{info.title}</h3>
            <p className="text-sm text-gray-500 capitalize">{info.startAt.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'})}</p>
          </div>
          <span className="text-xl font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg shrink-0">{info.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        
        <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-md mb-3 inline-block">Prof : {info.instructor}</span>
        {info.description && <p className="text-sm text-gray-600 mb-4 bg-gray-50 p-3 rounded-xl border border-gray-100">{info.description}</p>}
        
        <div className="flex gap-4 text-sm text-gray-500 mb-6 font-medium">
          <span className={`flex gap-1.5 items-center ${isFull && !isBooked ? 'text-red-500' : ''}`}><User size={16}/> {info.attendeesCount}/{info.maxCapacity}</span>
          <span className="flex gap-1.5 items-center"><MapPin size={16}/> {info.location}</span>
        </div>
      </div>

      {isBooked ? (
        <button onClick={() => onCancelClick(info.id)} disabled={isProcessing} className="w-full py-3 rounded-xl font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200">
          {isProcessing ? '...' : 'Annuler ma réservation'}
        </button>
      ) : (
        <button 
          onClick={() => onBookClick(info.id)} 
          disabled={!canBook || isFull || isProcessing || info.endAt < new Date()} 
          className={`w-full py-3 rounded-xl font-bold text-white transition-all 
            ${!canBook || isFull || info.endAt < new Date() ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-200'}
          `}
        >
          {isProcessing ? '...' : info.endAt < new Date() ? 'Terminé' : !canBook ? 'Fiche requise' : isFull ? 'Cours Complet' : 'Réserver ma place'}
        </button>
      )}

      {userProfile?.role === 'admin' && (
        <div className="mt-4">
          <button onClick={() => setShowAttendees(!showAttendees)} className="w-full flex items-center justify-center gap-2 py-2 text-sm font-bold text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors">
            <Users size={16}/> {showAttendees ? 'Masquer les inscrits' : 'Voir les inscrits'} {showAttendees ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
          </button>
          {showAttendees && <AdminClassAttendees classId={info.id} />}
        </div>
      )}
    </div>
  );
};

// Formulaire Édition/Création Cours Admin
const AdminClassForm = ({ onAdd, locations, editClassData, onCancelEdit }: { onAdd: () => void, locations: string[], editClassData: DanceClass | null, onCancelEdit: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState({title: 'Pole Débutant', date: '', desc: '', cap: 12, loc: locations[0] || 'Studio A'});
  
  useEffect(() => {
    if (editClassData) {
      setData({ title: editClassData.title, date: formatForInput(editClassData.startAt), desc: editClassData.description || '', cap: editClassData.maxCapacity, loc: editClassData.location });
      setIsOpen(true);
    } else {
      if(!data.loc && locations.length > 0) setData(prev => ({...prev, loc: locations[0]}));
    }
  }, [editClassData, locations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!data.date) return;
    try {
      const start = new Date(data.date);
      const payload = {
        title: data.title, description: data.desc, instructor: "Ali", location: data.loc,
        startAt: Timestamp.fromDate(start), endAt: Timestamp.fromDate(new Date(start.getTime() + 90*60000)),
        maxCapacity: Number(data.cap)
      };

      if (editClassData) await updateDoc(doc(db, "classes", editClassData.id), payload);
      else await addDoc(collection(db, "classes"), { ...payload, attendeesCount: 0, attendeeIds: [] });
      
      setIsOpen(false); onCancelEdit(); onAdd();
    } catch (e) { alert("Erreur"); }
  };
  
  const handleClose = () => { setIsOpen(false); onCancelEdit(); };

  if (!isOpen && !editClassData) return <button onClick={() => setIsOpen(true)} className="w-full mb-6 border-2 border-dashed border-amber-300 text-amber-700 py-4 rounded-xl flex justify-center items-center gap-2 font-bold hover:bg-amber-50"><Plus/> Créer un nouveau cours</button>;

  return (
    <div className="bg-white p-5 rounded-xl mb-6 border border-amber-100 shadow-sm relative">
      <h3 className="font-bold text-amber-800 mb-4">{editClassData ? 'Modifier le cours' : 'Nouveau Cours'}</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input value={data.title} onChange={e=>setData({...data, title: e.target.value})} className="w-full p-2 border rounded" placeholder="Titre du cours"/>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input type="datetime-local" value={data.date} onChange={e=>setData({...data, date: e.target.value})} className="w-full p-2 border rounded col-span-1 md:col-span-1"/>
          <select value={data.loc} onChange={e=>setData({...data, loc: e.target.value})} className="w-full p-2 border rounded bg-white">
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <div className="flex items-center gap-2 bg-gray-50 px-2 rounded border">
            <span className="text-xs text-gray-500 whitespace-nowrap">Places:</span>
            <input type="number" value={data.cap} onChange={e=>setData({...data, cap: Number(e.target.value)})} className="w-full bg-transparent p-2 outline-none"/>
          </div>
        </div>
        <textarea value={data.desc} onChange={e=>setData({...data, desc: e.target.value})} className="w-full p-2 border rounded" placeholder="Description (Tenue, Niveau...)"/>
        <div className="flex gap-2"><button type="button" onClick={handleClose} className="flex-1 py-2 bg-gray-100 rounded text-gray-600 font-bold">Annuler</button><button type="submit" className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded font-bold">{editClassData ? 'Mettre à jour' : 'Valider'}</button></div>
      </form>
    </div>
  );
};

// --- 5. APPLICATION PRINCIPALE ---
export default function App() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'planning' | 'history' | 'admin_students' | 'admin_past'>('planning');
  const [classes, setClasses] = useState<DanceClass[]>([]);
  const [pastClasses, setPastClasses] = useState<DanceClass[]>([]);
  const [locations, setLocations] = useState<string[]>(['Studio Picardia']);
  const [myBookings, setMyBookings] = useState<BookingInfo[]>([]);
  
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  
  // Modales
  const [paymentModal, setPaymentModal] = useState<{isOpen: boolean, classId: string | null}>({isOpen: false, classId: null});
  const [isPaymentInfoOpen, setPaymentInfoOpen] = useState(false);
  const [isBookingSuccessOpen, setBookingSuccessOpen] = useState(false);
  
  const [editingClass, setEditingClass] = useState<DanceClass | null>(null);

  // Vérifier s'il y a un paiement en attente
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
      if (docSnap.exists() && docSnap.data().locations) setLocations(docSnap.data().locations);
      else setDoc(doc(db, "settings", "general"), { locations: ['Studio Picardia'] }, { merge: true });
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
          dateStr, timeStr, location: classData.location,
          paymentMethod: method, paymentStatus
        });
        return { title: classData.title, dateStr, timeStr, loc: classData.location, cap: classData.maxCapacity, paymentStatus, method };
      }).then((d) => {
        syncToSheet({ type: 'BOOKING', classId, classTitle: d.title, date: d.dateStr, time: d.timeStr, location: d.loc, capacity: d.cap, studentId: userProfile.id, studentName: `${userProfile.displayName} (${d.method})`, paymentStatus: d.paymentStatus });
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
      let method = 'CASH'; let bookingId = null;
      if (!snap.empty) { bookingId = snap.docs[0].id; method = snap.docs[0].data().paymentMethod; }

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

      syncToSheet({ type: 'CANCEL', classId, studentId: userProfile.id });
      alert("Réservation annulée !"); fetchAllData();
    } catch (e) { alert("Erreur: " + e); }
    setProcessingId(null);
  };

  // --- RENDU UI ---
  if (authLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-amber-600"/></div>;
  if (!authUser) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-700 flex items-center justify-center p-4">
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
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans pb-32">
      <div className="w-full max-w-[1600px] mx-auto">
        
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
             {authUser?.photoURL && <img src={authUser.photoURL} className="w-12 h-12 rounded-full border-2 border-amber-200 shadow-sm"/>}
             <div>
               <h1 className="text-lg font-bold text-gray-900 leading-tight">Bonjour {authUser?.displayName?.split(' ')[0]}</h1>
               <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mt-2">
                 <button onClick={() => setPaymentInfoOpen(true)} className={`font-bold px-3 py-1.5 rounded-lg transition-all border ${hasPendingPayments ? 'bg-red-50 text-red-600 border-red-200 shadow-[0_0_10px_rgba(239,68,68,0.2)] animate-pulse' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                   Moyens de paiement
                 </button>
                 <button onClick={() => setShowProfile(true)} className="text-gray-500 hover:text-amber-600 font-medium">Mon Profil</button>
                 <span className="text-gray-300 hidden sm:inline">•</span>
                 <button onClick={() => signOut(auth)} className="text-gray-500 hover:text-red-500">Déconnexion</button>
               </div>
             </div>
          </div>
          <div className="px-4 py-2 bg-white border border-amber-100 rounded-xl shadow-sm text-lg font-bold text-amber-700 flex items-center gap-2 self-start sm:self-auto">
            <Zap size={18} className="fill-amber-600" /> {userProfile?.credits ?? 0}
          </div>
        </header>

        {userProfile && !userProfile.hasFilledForm && (
          <div className="bg-red-50 border-2 border-red-200 p-4 rounded-2xl mb-8 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3 text-red-700 font-medium text-sm">
               <AlertTriangle size={24} className="shrink-0" />
               <p>Tu dois obligatoirement remplir la <b>fiche d'inscription (santé & droit à l'image)</b> pour pouvoir réserver un cours.</p>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
               <a href="https://docs.google.com/forms/d/e/1FAIpQLScFB9AwnG5svoixfNDer61h98heVkQP5bRPGww8x05XcNy9HQ/viewform" target="_blank" rel="noreferrer" className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition-colors">
                  <ExternalLink size={16}/> Ouvrir le formulaire
               </a>
               <button onClick={handleValidateForm} className="flex-1 md:flex-none px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold transition-colors">
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
            </>
          )}
        </nav>

        {activeTab === 'planning' && (
          <div>
            {userProfile?.role === 'admin' && <AdminClassForm onAdd={fetchAllData} locations={locations} editClassData={editingClass} onCancelEdit={() => setEditingClass(null)} />}
            {classes.length === 0 ? ( <div className="bg-white rounded-2xl p-10 text-center text-gray-400">Aucun cours à venir.</div> ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-6">
                {classes.map(c => <ClassCard key={c.id} info={c} onDelete={async(id:string)=>{await deleteDoc(doc(db,"classes",id)); fetchAllData()}} onEditClick={setEditingClass} onBookClick={initiateBooking} onCancelClick={handleCancel} processingId={processingId} userProfile={userProfile} isBooked={c.attendeeIds?.includes(userProfile?.id || '')} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-3xl">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><History className="text-amber-600"/> Mon Historique</h2>
            {myBookings.length === 0 ? <p className="text-gray-500">Aucun cours réservé pour le moment.</p> : (
              <div className="space-y-4">
                {myBookings.map(b => (
                  <div key={b.id} className="flex justify-between items-center p-4 rounded-xl border border-gray-100 bg-gray-50 hover:bg-white transition-colors">
                    <div>
                      <h3 className="font-bold text-gray-800">{b.classTitle}</h3>
                      <p className="text-sm text-gray-500 capitalize">{new Date(b.date).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'})}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-gray-500 block mb-1">Via {b.paymentMethod}</span>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-6 opacity-75">
                {pastClasses.map(c => <ClassCard key={c.id} info={c} onDelete={async(id:string)=>{await deleteDoc(doc(db,"classes",id)); fetchAllData()}} processingId={null} userProfile={userProfile} isBooked={false} onBookClick={()=>{}} onCancelClick={()=>{}} />)}
              </div>
            )}
          </div>
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
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="bg-white border-2 border-gray-800 rounded-2xl p-4 w-full lg:w-1/3">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Users size={18}/> Liste des élèves</h3>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
          {users.map(u => (
            <div key={u.id} className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-colors ${selectedUserId === u.id ? 'border-gray-800 bg-gray-50' : 'border-gray-100 hover:border-gray-300'}`} onClick={() => setSelectedUserId(u.id)}>
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-sm text-gray-800">{u.displayName}</span>
                {!u.hasFilledForm && <AlertTriangle size={14} className="text-red-500" title="Fiche non remplie" />}
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
