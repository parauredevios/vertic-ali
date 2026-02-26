import React, { useState, useEffect } from 'react';
import { 
  Calendar, User, MapPin, Plus, Trash2, Zap, Loader2, Edit2, AlertTriangle, ExternalLink,
  Phone, HeartPulse, Wallet, Home, CheckCircle, Clock, History, Users, Archive, ChevronDown, ChevronUp,
  Smartphone, Building, ShoppingBag, XCircle, UserPlus, Settings, Map, FileText, Download, FileCheck,
  LayoutDashboard, TrendingUp, Briefcase, FileSignature, FileSpreadsheet
} from 'lucide-react';
import { db, auth } from './lib/firebase'; 
import { 
  collection, getDocs, addDoc, Timestamp, deleteDoc, doc, runTransaction, onSnapshot, setDoc, updateDoc, query, orderBy, where 
} from 'firebase/firestore';
import { 
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import jsPDF from 'jspdf'; 

// --- CONFIGURATION ---
// ⚠️ COLLE TON URL GOOGLE SCRIPT ICI ⚠️
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzxqnW1O5bfVWLQpHuvXkouogYiUugO43jmEAB_QJMadCKfLFNpRXuf7XcZ6fg4ZGDG0w/exec"; 

// --- 1. MODÈLES & TYPES ---
interface StudioLocation { id: string; name: string; address: string; }
interface ClassTemplate { id: string; title: string; locationName: string; price: string; maxCapacity: number; description: string; }
interface GlobalSettings { reminderDays: number; }

interface DanceClass {
  id: string; title: string; description?: string; price: string;
  startAt: Date; endAt: Date; maxCapacity: number; attendeesCount: number;
  attendeeIds: string[]; instructor: string; location: string; locationAddress?: string;
  invoiceArchived?: boolean; 
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

interface ProClient { id: string; name: string; address: string; siret?: string; }
interface B2BInvoice {
  id: string; clientId: string; clientName: string; date: string;
  desc: string; qty: number; price: number; total: number;
  status: 'DEVIS' | 'FACTURE'; paymentStatus: 'PENDING' | 'PAID';
  paymentMethod: 'ESPECE' | 'VIREMENT_RIB' | 'WERO_PAYPAL';
}

type PaymentMethod = 'CREDIT' | 'CASH' | 'WERO_RIB';

// --- 2. FONCTION SYNC GOOGLE SHEETS ---
const syncToSheet = async (payload: any) => {
  if (GOOGLE_SCRIPT_URL.includes("TA_NOUVELLE_URL") || GOOGLE_SCRIPT_URL.includes("TA_URL_GOOGLE")) return; 
  try {
    const enrichedPayload = { ...payload };
    if (payload.type === 'BOOKING') enrichedPayload.sheetName = payload.paymentStatus === 'PAID' ? 'Payer' : 'NON PAYÉ';
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST", mode: "no-cors", 
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(enrichedPayload)
    });
  } catch (e) { console.error("Erreur Sync Sheets", e); }
};

const formatForInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// --- FONCTIONS GENERATION PDF ---
const getBase64ImageFromUrl = async (imageUrl: string) => {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.drawImage(img, 0, 0); resolve(canvas.toDataURL('image/png')); } else reject('Canvas error');
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
};

const renderInvoiceBase = async (doc: jsPDF, typeDoc: string, invNumber: string, dateStr: string, clientName: string, clientAddress: string, clientSiret?: string) => {
  try {
    const logoBase64 = await getBase64ImageFromUrl('/logo.png');
    doc.addImage(logoBase64, 'PNG', 15, 15, 35, 35);
  } catch (e) {
    doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.text("Vertic'Ali", 15, 25);
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(212, 175, 55); 
  doc.text(typeDoc, 150, 25);
  
  doc.setTextColor(0, 0, 0); doc.setFontSize(10); doc.setFont("helvetica", "bold");
  doc.text(`N° ${typeDoc.toLowerCase()}`, 150, 35); doc.setFont("helvetica", "normal"); doc.text(invNumber, 150, 40);
  doc.setFont("helvetica", "bold"); doc.text("Date", 150, 50); doc.setFont("helvetica", "normal"); doc.text(dateStr, 150, 55);

  doc.setFont("helvetica", "bold"); doc.text("Facturé à :", 15, 60); doc.setFont("helvetica", "normal");
  doc.text(clientName, 15, 65);
  if (clientAddress) {
    const splitAddress = doc.splitTextToSize(clientAddress, 80);
    doc.text(splitAddress, 15, 70);
  } else {
    doc.text("Adresse non renseignée", 15, 70);
  }
  if (clientSiret) {
    doc.text(`N° SIRET : ${clientSiret}`, 15, 85);
  }

  doc.setFillColor(212, 175, 55); doc.rect(15, 95, 180, 8, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold");
  doc.text("Description", 20, 100.5); doc.text("Qté", 110, 100.5); doc.text("Prix unitaire", 130, 100.5);
  doc.text("TVA (%)", 155, 100.5); doc.text("Montant HT", 175, 100.5);
  doc.setTextColor(0, 0, 0); 
};

const renderInvoiceFooter = (doc: jsPDF, totalStr: string) => {
  doc.setDrawColor(200); doc.line(15, 130, 195, 130);
  doc.setFont("helvetica", "bold");
  doc.text("Total HT", 140, 140); doc.text("TVA", 140, 147); doc.text("Total TTC", 140, 157);
  doc.setFont("helvetica", "normal");
  doc.text(totalStr, 175, 140); doc.text("0,00 €", 175, 147);
  doc.setFont("helvetica", "bold"); doc.setTextColor(212, 175, 55); doc.text(totalStr, 175, 157);

  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
  const footerLines = [
    "TVA non applicable selon l'article 293B du code général des impôts.",
    "Pas d'escompte accordé pour paiement anticipé.",
    "En cas de non-paiement à la date d'échéance, des pénalités calculées à trois fois le taux d'intérêt légal seront appliquées.",
    "Tout retard de paiement entraînera une indemnité forfaitaire pour frais de recouvrement de 40€.",
    "RIB pour paiement par virement: FR2120041010052736887X02624 - BIC: PSSTFRPPLIL", "",
    "Vertic'Ali - Alison BOUTELEUX - Entreprise individuelle",
    "18 rue Maurice Domon, Appt C22, 80000 AMIENS",
    "Tél: 06.21.05.64.14 - Mail: verticali.poledance@gmail.com", "SIRET: 94819885800029"
  ];
  let y = 230;
  footerLines.forEach(line => { doc.text(line, 105, y, { align: "center" }); y += 4.5; });
};

const generateInvoicePDF = async (booking: BookingInfo, studentProfile: UserProfile | null, classInfo: DanceClass) => {
  const doc = new jsPDF();
  const dateStr = new Date().toLocaleDateString('fr-FR');
  const invNumber = `FAC-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}-${booking.userId.slice(0,4).toUpperCase()}`;
  const clientName = booking.userName.replace(" (Manuel)", "");
  const address = studentProfile?.street ? `${studentProfile.street}\n${studentProfile.zipCode || ''} ${studentProfile.city || ''}` : '';
  
  await renderInvoiceBase(doc, "FACTURE", invNumber, dateStr, clientName, address);
  
  let rawPrice = classInfo.price || '0';
  rawPrice = rawPrice.replace('€', '').replace('Crédit', '').replace('crédit', '').trim();
  if (isNaN(Number(rawPrice))) rawPrice = "0"; 
  const priceVal = `${rawPrice},00 €`;
  
  doc.setFont("helvetica", "normal"); doc.text(classInfo.title, 20, 110); doc.setFontSize(8);
  doc.text(`Le ${classInfo.startAt.toLocaleDateString('fr-FR')} à ${classInfo.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}`, 20, 115);
  doc.setFontSize(10);
  doc.text("1", 112, 110); doc.text(priceVal, 130, 110); doc.text("0", 160, 110); doc.text(priceVal, 175, 110);
  
  renderInvoiceFooter(doc, priceVal);
  doc.save(`Facture_${clientName.replace(/\s+/g, '_')}_${classInfo.startAt.toLocaleDateString('fr-FR').replace(/\//g,'')}.pdf`);
};

const generateB2BInvoicePDF = async (invoice: B2BInvoice, client: ProClient) => {
  const doc = new jsPDF();
  const dateStr = new Date(invoice.date).toLocaleDateString('fr-FR');
  const typeDoc = invoice.status === 'DEVIS' ? 'DEVIS' : 'FACTURE';
  const prefix = invoice.status === 'DEVIS' ? 'DEV' : 'FAC';
  const invNumber = `${prefix}-PRO-${new Date(invoice.date).getFullYear()}${String(new Date(invoice.date).getMonth()+1).padStart(2,'0')}-${invoice.id.slice(0,4).toUpperCase()}`;
  
  await renderInvoiceBase(doc, typeDoc, invNumber, dateStr, client.name, client.address, client.siret);
  
  const priceVal = `${invoice.price.toFixed(2).replace('.', ',')} €`;
  const totalVal = `${invoice.total.toFixed(2).replace('.', ',')} €`;
  
  doc.setFont("helvetica", "normal");
  const splitDesc = doc.splitTextToSize(invoice.desc, 85);
  doc.text(splitDesc, 20, 110);
  doc.text(invoice.qty.toString(), 112, 110); doc.text(priceVal, 130, 110); doc.text("0", 160, 110); doc.text(totalVal, 175, 110);
  
  renderInvoiceFooter(doc, totalVal);
  doc.save(`${typeDoc}_PRO_${client.name.replace(/\s+/g, '_')}_${dateStr.replace(/\//g,'')}.pdf`);
};

// --- TABLEAU DE BORD ADMIN (AVEC EXPORT URSSAF) ---
const AdminDashboardTab = ({ reminderDays }: { reminderDays: number }) => {
  const [stats, setStats] = useState({ caMonthB2C: 0, caMonthB2B: 0, pendingCount: 0 });
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // States pour l'export URSSAF
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const fetchDashboardData = async () => {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      let caB2C = 0; let caB2B = 0;
      let lateItems: any[] = [];

      const snapB2C = await getDocs(query(collection(db, "bookings")));
      snapB2C.docs.forEach(d => {
        const b = { id: d.id, ...d.data() } as BookingInfo;
        const bDate = new Date(b.date);
        
        if (b.paymentStatus === 'PAID' && bDate >= firstDayOfMonth) {
          let priceNum = Number((b.price || '0').replace('€', '').replace('Crédit', '').trim());
          if (!isNaN(priceNum)) caB2C += priceNum;
        }

        if (b.paymentStatus === 'PENDING') {
          const diffTime = Math.abs(now.getTime() - bDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
          if (diffDays >= reminderDays && bDate < now) {
            lateItems.push({
              id: b.id, name: b.userName.replace(' (Manuel)', ''),
              desc: `${b.classTitle} du ${bDate.toLocaleDateString('fr-FR')}`,
              price: b.price || '?', method: b.paymentMethod, type: 'Élève', dateObj: bDate
            });
          }
        }
      });

      const snapB2B = await getDocs(query(collection(db, "b2b_invoices")));
      snapB2B.docs.forEach(d => {
        const b = { id: d.id, ...d.data() } as B2BInvoice;
        const bDate = new Date(b.date);
        
        if (b.status === 'FACTURE' && b.paymentStatus === 'PAID' && bDate >= firstDayOfMonth) {
          caB2B += b.total;
        }

        if (b.status === 'FACTURE' && b.paymentStatus === 'PENDING') {
          const diffTime = Math.abs(now.getTime() - bDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
          if (diffDays >= reminderDays && bDate < now) {
            lateItems.push({
              id: b.id, name: b.clientName,
              desc: `Prestation PRO : ${b.desc} (${bDate.toLocaleDateString('fr-FR')})`,
              price: `${b.total} €`, method: b.paymentMethod, type: 'PRO', dateObj: bDate
            });
          }
        }
      });

      setStats({ caMonthB2C: caB2C, caMonthB2B: caB2B, pendingCount: lateItems.length });
      setReminders(lateItems.sort((a,b) => b.dateObj.getTime() - a.dateObj.getTime()));
      setLoading(false);
    };
    fetchDashboardData();
  }, [reminderDays]);

  // FONCTION MAGIQUE : EXPORT URSSAF CSV
  const handleExportCSV = async (start: Date, end: Date, periodName: string) => {
    setIsExporting(true);
    try {
      const endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);
      
      let exportRows: any[] = [];

      // 1. Récupération B2C (Élèves Payés)
      const snapB2C = await getDocs(query(collection(db, "bookings"), where("paymentStatus", "==", "PAID")));
      snapB2C.docs.forEach(d => {
        const b = d.data() as BookingInfo;
        const bDate = new Date(b.date);
        if (bDate >= start && bDate <= endOfDay) {
          let priceNum = Number((b.price || '0').replace('€', '').replace('Crédit', '').trim());
          if (!isNaN(priceNum) && priceNum > 0) { // Ne pas compter les prix mal formés ou à 0
            exportRows.push({
              dateObj: bDate, dateStr: bDate.toLocaleDateString('fr-FR'),
              type: 'B2C (Élève)', client: b.userName.replace(' (Manuel)', ''),
              desc: b.classTitle, method: b.paymentMethod, amount: priceNum
            });
          }
        }
      });

      // 2. Récupération B2B (Pros Payés)
      const snapB2B = await getDocs(query(collection(db, "b2b_invoices"), where("status", "==", "FACTURE"), where("paymentStatus", "==", "PAID")));
      snapB2B.docs.forEach(d => {
        const b = d.data() as B2BInvoice;
        const bDate = new Date(b.date);
        if (bDate >= start && bDate <= endOfDay) {
          exportRows.push({
            dateObj: bDate, dateStr: bDate.toLocaleDateString('fr-FR'),
            type: 'B2B (PRO)', client: b.clientName,
            desc: b.desc, method: b.paymentMethod, amount: b.total
          });
        }
      });

      // Tri chronologique
      exportRows.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

      // Construction du CSV avec le BOM UTF-8 (pour qu'Excel lise bien les accents français)
      let csvContent = "Date;Type de Client;Nom du Client;Description;Moyen de Paiement;Montant (EUR)\n";
      let totalAmount = 0;
      
      exportRows.forEach(r => {
        // Remplacement des sauts de ligne et guillemets pour éviter de casser le CSV
        const safeDesc = r.desc.replace(/"/g, '""').replace(/\n/g, ' '); 
        const safeClient = r.client.replace(/"/g, '""');
        csvContent += `${r.dateStr};${r.type};"${safeClient}";"${safeDesc}";${r.method};${r.amount}\n`;
        totalAmount += r.amount;
      });
      
      // Ligne de Total à la fin
      csvContent += `;;;;TOTAL;${totalAmount}\n`;

      // Création et téléchargement du fichier
      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `Export_URSSAF_${periodName}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      alert("Erreur lors de la création de l'export.");
    }
    setIsExporting(false);
  };

  const exportCurrentMonth = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    handleExportCSV(firstDay, lastDay, `Mois_${now.getMonth()+1}_${now.getFullYear()}`);
  };

  const exportCustomPeriod = () => {
    if (!exportStartDate || !exportEndDate) return alert("Veuillez sélectionner les deux dates.");
    const start = new Date(exportStartDate);
    const end = new Date(exportEndDate);
    if (start > end) return alert("La date de début doit être avant la date de fin.");
    handleExportCSV(start, end, `Periode_${exportStartDate}_au_${exportEndDate}`);
  };

  if (loading) return <div className="text-center p-10 text-gray-500"><Loader2 className="animate-spin inline mr-2"/> Chargement des statistiques...</div>;

  return (
    <div className="space-y-8 text-left">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-6">
          <div className="p-4 bg-green-50 text-green-600 rounded-xl"><TrendingUp size={32}/></div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">CA Élèves (Mois)</p>
            <p className="text-2xl font-black text-gray-800">{stats.caMonthB2C} €</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-6">
          <div className="p-4 bg-indigo-50 text-indigo-600 rounded-xl"><Briefcase size={32}/></div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">CA Presta PRO (Mois)</p>
            <p className="text-2xl font-black text-gray-800">{stats.caMonthB2B} €</p>
          </div>
        </div>
        <div className="bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-700 flex items-center gap-6">
          <div className="p-4 bg-amber-500 text-gray-900 rounded-xl"><Wallet size={32}/></div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">CA TOTAL (Mois)</p>
            <p className="text-2xl font-black text-white">{stats.caMonthB2C + stats.caMonthB2B} €</p>
          </div>
        </div>
      </div>

      {/* --- NOUVEAU : ENCART EXPORT URSSAF --- */}
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 ring-4 ring-indigo-50 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl"><FileSpreadsheet size={24}/></div>
            <div>
              <h3 className="font-bold text-indigo-900 text-lg">Export Comptable URSSAF</h3>
              <p className="text-sm text-indigo-700/70 font-medium">Téléchargez les recettes (B2C et B2B) au format Excel CSV.</p>
            </div>
          </div>
          <button 
            onClick={exportCurrentMonth} 
            disabled={isExporting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            {isExporting ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>} Export du Mois en cours
          </button>
        </div>
        
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4">
          <span className="text-sm font-bold text-gray-600 whitespace-nowrap">Ou choisir une période :</span>
          <input type="date" value={exportStartDate} onChange={e=>setExportStartDate(e.target.value)} className="w-full md:w-auto p-2 border border-gray-300 rounded-lg text-sm focus:border-indigo-500 outline-none" />
          <span className="text-sm font-bold text-gray-400">à</span>
          <input type="date" value={exportEndDate} onChange={e=>setExportEndDate(e.target.value)} className="w-full md:w-auto p-2 border border-gray-300 rounded-lg text-sm focus:border-indigo-500 outline-none" />
          <button 
            onClick={exportCustomPeriod} 
            disabled={isExporting || !exportStartDate || !exportEndDate}
            className="w-full md:w-auto bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-bold text-sm transition-colors disabled:opacity-50"
          >
            Exporter
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-5 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
          <AlertTriangle className="text-orange-500"/>
          <h3 className="font-bold text-gray-800 text-lg">Règlements à relancer (Retard &gt; {reminderDays} j)</h3>
        </div>
        <div className="p-5">
          {reminders.length === 0 ? (
            <p className="text-gray-500 text-sm">Aucun paiement en retard. Bravo !</p>
          ) : (
            <div className="space-y-3">
              {reminders.map(r => (
                <div key={r.id} className="flex justify-between items-center bg-white p-4 rounded-xl border border-red-100 shadow-sm">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${r.type === 'PRO' ? 'bg-indigo-100 text-indigo-700' : 'bg-green-100 text-green-700'}`}>{r.type}</span>
                      <p className="font-bold text-gray-800">{r.name}</p>
                    </div>
                    <p className="text-xs text-gray-500">{r.desc}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-red-600">{r.price}</p>
                    <p className="text-xs text-gray-400">Via {r.method}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- ONGLET FACTURES ADMIN (B2C + B2B) ---
const AdminInvoicesTab = ({ pastClasses, onRefresh }: { pastClasses: DanceClass[], onRefresh: () => void }) => {
  const [viewMode, setViewMode] = useState<'PENDING' | 'ARCHIVED' | 'B2B'>('PENDING');
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const [classBookings, setClassBookings] = useState<BookingInfo[]>([]);
  const [usersInfo, setUsersInfo] = useState<{ [key: string]: UserProfile }>({});
  
  const [proClients, setProClients] = useState<ProClient[]>([]);
  const [b2bInvoices, setB2bInvoices] = useState<B2BInvoice[]>([]);
  const [newProClient, setNewProClient] = useState<Partial<ProClient>>({});
  const [b2bInvoiceData, setB2bInvoiceData] = useState({ clientId: '', desc: '', qty: 1, price: 0 });

  const classesToDisplay = pastClasses.filter(c => viewMode === 'PENDING' ? !c.invoiceArchived : c.invoiceArchived);

  useEffect(() => {
    const fetchAll = async () => {
      const uSnap = await getDocs(collection(db, "users"));
      const usersMap: any = {}; uSnap.docs.forEach(d => { usersMap[d.id] = { id: d.id, ...d.data() }; });
      setUsersInfo(usersMap);

      const pSnap = await getDocs(collection(db, "pro_clients"));
      setProClients(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProClient)));

      const iSnap = await getDocs(query(collection(db, "b2b_invoices"), orderBy("date", "desc")));
      setB2bInvoices(iSnap.docs.map(d => ({ id: d.id, ...d.data() } as B2BInvoice)));
    };
    fetchAll();
  }, [viewMode]);

  const loadBookings = async (classId: string) => {
    if (expandedClass === classId) { setExpandedClass(null); return; }
    const snap = await getDocs(query(collection(db, "bookings"), where("classId", "==", classId)));
    setClassBookings(snap.docs.map(d => ({ id: d.id, ...d.data() } as BookingInfo)));
    setExpandedClass(classId);
  };
  const generateAll = (classInfo: DanceClass) => { classBookings.forEach(b => generateInvoicePDF(b, usersInfo[b.userId] || null, classInfo)); };
  const toggleArchiveStatus = async (classId: string, currentStatus: boolean | undefined) => {
    if(!confirm(currentStatus ? "Désarchiver et remettre dans 'À traiter' ?" : "Archiver ce cours ?")) return;
    await updateDoc(doc(db, "classes", classId), { invoiceArchived: !currentStatus });
    onRefresh();
  };

  const handleAddProClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProClient.name || !newProClient.address) return alert("Le nom et l'adresse sont obligatoires.");
    await addDoc(collection(db, "pro_clients"), newProClient);
    setNewProClient({ name: '', address: '', siret: '' });
    const snap = await getDocs(collection(db, "pro_clients")); setProClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProClient)));
  };
  const handleDeleteProClient = async (id: string) => {
    if (!confirm("Supprimer ce client pro de l'annuaire ?")) return;
    await deleteDoc(doc(db, "pro_clients", id));
    setProClients(proClients.filter(c => c.id !== id));
  };

  const handleCreateDevis = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = proClients.find(c => c.id === b2bInvoiceData.clientId);
    if (!client) return alert("Sélectionnez un client valide.");
    if (!b2bInvoiceData.desc || b2bInvoiceData.price <= 0 || b2bInvoiceData.qty <= 0) return alert("Remplissez la description, quantité et prix.");
    
    const newInv: Omit<B2BInvoice, 'id'> = {
      clientId: client.id, clientName: client.name, date: new Date().toISOString(),
      desc: b2bInvoiceData.desc, qty: b2bInvoiceData.qty, price: b2bInvoiceData.price, total: b2bInvoiceData.qty * b2bInvoiceData.price,
      status: 'DEVIS', paymentStatus: 'PENDING', paymentMethod: 'VIREMENT_RIB'
    };
    
    const docRef = await addDoc(collection(db, "b2b_invoices"), newInv);
    setB2bInvoices([{ id: docRef.id, ...newInv }, ...b2bInvoices]);
    setB2bInvoiceData({ clientId: '', desc: '', qty: 1, price: 0 }); 
  };

  const handleB2BAction = async (invoice: B2BInvoice, action: 'TO_FACTURE' | 'TOGGLE_PAYMENT' | 'CHANGE_METHOD', newVal?: string) => {
    const ref = doc(db, "b2b_invoices", invoice.id);
    let updates: any = {};

    if (action === 'TO_FACTURE') {
      if(!confirm("Transformer ce Devis en Facture officielle ? (Ceci l'enverra dans la comptabilité)")) return;
      updates = { status: 'FACTURE', date: new Date().toISOString() }; 
    } 
    else if (action === 'TOGGLE_PAYMENT') {
      updates = { paymentStatus: invoice.paymentStatus === 'PAID' ? 'PENDING' : 'PAID' };
    }
    else if (action === 'CHANGE_METHOD' && newVal) {
      updates = { paymentMethod: newVal };
    }

    await updateDoc(ref, updates);
    const updatedInvoice = { ...invoice, ...updates };
    setB2bInvoices(b2bInvoices.map(i => i.id === invoice.id ? updatedInvoice : i));

    if (updatedInvoice.status === 'FACTURE') {
      syncToSheet({
        type: 'B2B_UPDATE', id: updatedInvoice.id, clientName: updatedInvoice.clientName,
        date: new Date(updatedInvoice.date).toLocaleDateString('fr-FR'), desc: updatedInvoice.desc,
        qty: updatedInvoice.qty, price: updatedInvoice.price, total: updatedInvoice.total,
        paymentStatus: updatedInvoice.paymentStatus, paymentMethod: updatedInvoice.paymentMethod
      });
    }
  };

  return (
    <div className="space-y-6 text-left">
      <div className="flex gap-2 p-1 bg-gray-200 rounded-xl w-fit">
        <button onClick={() => setViewMode('PENDING')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${viewMode === 'PENDING' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Élèves (À traiter)</button>
        <button onClick={() => setViewMode('ARCHIVED')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${viewMode === 'ARCHIVED' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Élèves (Archives)</button>
        <button onClick={() => setViewMode('B2B')} className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-1 ${viewMode === 'B2B' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Briefcase size={14}/> Prestations PRO
        </button>
      </div>

      {viewMode === 'B2B' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
              <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><Users className="text-indigo-500"/> Annuaire Clients Pro</h3>
              <form onSubmit={handleAddProClient} className="flex flex-col gap-2 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
                <input value={newProClient.name || ''} onChange={e=>setNewProClient({...newProClient, name: e.target.value})} placeholder="Nom de l'entreprise ou du Studio *" className="p-2 border rounded-lg text-sm outline-none"/>
                <input value={newProClient.address || ''} onChange={e=>setNewProClient({...newProClient, address: e.target.value})} placeholder="Adresse complète *" className="p-2 border rounded-lg text-sm outline-none"/>
                <input value={newProClient.siret || ''} onChange={e=>setNewProClient({...newProClient, siret: e.target.value})} placeholder="N° SIRET (Optionnel)" className="p-2 border rounded-lg text-sm outline-none"/>
                <button type="submit" className="bg-indigo-600 text-white font-bold py-2 rounded-lg hover:bg-indigo-700 mt-2">Ajouter à l'annuaire</button>
              </form>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                {proClients.map(c => (
                  <div key={c.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                    <div>
                      <p className="font-bold text-sm text-gray-800">{c.name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">{c.address}</p>
                    </div>
                    <button onClick={() => handleDeleteProClient(c.id)} className="text-red-500 p-2 hover:bg-red-50 rounded-md"><Trash2 size={16}/></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-200 ring-4 ring-indigo-50">
              <h3 className="font-bold text-indigo-900 mb-6 flex items-center gap-2 text-lg"><FileSignature className="text-indigo-600"/> Nouveau Devis PRO</h3>
              {proClients.length === 0 ? (
                <p className="text-sm text-gray-500 bg-gray-50 p-4 rounded-xl text-center border border-gray-200">Ajoutez d'abord un client pro dans l'annuaire.</p>
              ) : (
                <form onSubmit={handleCreateDevis} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Client Destinataire</label>
                    <select value={b2bInvoiceData.clientId} onChange={e=>setB2bInvoiceData({...b2bInvoiceData, clientId: e.target.value})} className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none focus:border-indigo-500 font-medium">
                      <option value="">-- Sélectionner un client --</option>
                      {proClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Description de la prestation</label>
                    <textarea value={b2bInvoiceData.desc} onChange={e=>setB2bInvoiceData({...b2bInvoiceData, desc: e.target.value})} placeholder="Ex: Show Pole Dance Soirée / Cours au taux horaire..." className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:border-indigo-500 min-h-[80px]"/>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Qté (Heures/Forfait)</label>
                      <input type="number" min="0.5" step="0.5" value={b2bInvoiceData.qty} onChange={e=>setB2bInvoiceData({...b2bInvoiceData, qty: Number(e.target.value)})} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:border-indigo-500 text-center font-bold"/>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Prix unitaire</label>
                      <input type="number" min="0" step="1" value={b2bInvoiceData.price} onChange={e=>setB2bInvoiceData({...b2bInvoiceData, price: Number(e.target.value)})} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:border-indigo-500 text-right font-bold"/>
                    </div>
                  </div>
                  <button type="submit" className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-bold py-3 rounded-xl shadow-md mt-2 transition-all">
                    Créer le Devis
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><FileText className="text-gray-500"/> Suivi des Prestations</h3>
            <div className="space-y-4">
              {b2bInvoices.length === 0 ? <p className="text-sm text-gray-500 italic">Aucun devis ou facture généré.</p> : b2bInvoices.map(inv => {
                const client = proClients.find(c => c.id === inv.clientId);
                return (
                  <div key={inv.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${inv.status === 'DEVIS' ? 'bg-gray-200 text-gray-700' : 'bg-indigo-100 text-indigo-700'}`}>{inv.status}</span>
                          <span className="font-bold text-gray-800">{inv.clientName}</span>
                        </div>
                        <p className="text-sm text-gray-600 font-medium">{inv.desc}</p>
                        <p className="text-xs text-gray-400 mt-1">{new Date(inv.date).toLocaleDateString('fr-FR')} • Qté: {inv.qty} • {inv.price}€/u</p>
                      </div>
                      <div className="text-right flex flex-col items-end gap-2">
                        <span className="text-lg font-black text-indigo-700">{inv.total} €</span>
                        {client && (
                          <button onClick={() => generateB2BInvoicePDF(inv, client)} className="flex items-center gap-1 text-xs font-bold bg-white border border-gray-300 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                            <Download size={12}/> {inv.status === 'DEVIS' ? 'Devis' : 'Facture'}
                          </button>
                        )}
                      </div>
                    </div>

                    {inv.status === 'DEVIS' ? (
                      <button onClick={() => handleB2BAction(inv, 'TO_FACTURE')} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors">
                        Passer en Facturation
                      </button>
                    ) : (
                      <div className="flex gap-2 items-center border-t border-gray-200 pt-3 mt-1">
                        <select 
                          value={inv.paymentMethod} 
                          onChange={(e) => handleB2BAction(inv, 'CHANGE_METHOD', e.target.value)}
                          className="flex-1 text-xs font-bold p-2 rounded-lg border border-gray-300 bg-white outline-none"
                        >
                          <option value="ESPECE">Espèces</option>
                          <option value="VIREMENT_RIB">Virement</option>
                          <option value="WERO_PAYPAL">Wero / Paypal</option>
                        </select>
                        <button 
                          onClick={() => handleB2BAction(inv, 'TOGGLE_PAYMENT')}
                          className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                            inv.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                          }`}
                        >
                          {inv.paymentStatus === 'PAID' ? <><CheckCircle size={14}/> Payé</> : <><Clock size={14}/> À régler</>}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      ) : (
        classesToDisplay.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl shadow-sm text-center text-gray-500">
            {viewMode === 'PENDING' ? "Tous les cours passés ont été archivés. Aucune facture en attente !" : "Aucune archive pour le moment."}
          </div>
        ) : (
          <div className="space-y-4">
            {classesToDisplay.map(c => (
              <div key={c.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden text-left">
                <div className="p-4 bg-gray-50 flex justify-between items-center cursor-pointer" onClick={() => loadBookings(c.id)}>
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">{c.title}</h3>
                    <p className="text-sm text-gray-500">{c.startAt.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'})} à {c.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold bg-white px-3 py-1 rounded-lg border border-gray-200 shadow-sm"><Users size={14} className="inline mr-1"/> {c.attendeesCount}</span>
                    {expandedClass === c.id ? <ChevronUp className="text-gray-400"/> : <ChevronDown className="text-gray-400"/>}
                  </div>
                </div>
                
                {expandedClass === c.id && (
                  <div className="p-5 border-t border-gray-200">
                    <div className="flex justify-between items-center mb-4">
                      <button onClick={() => generateAll(c)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-colors">
                        <Download size={16}/> Tout télécharger
                      </button>
                      <button onClick={() => toggleArchiveStatus(c.id, c.invoiceArchived)} className="text-gray-500 hover:text-indigo-600 font-bold text-sm flex items-center gap-1 transition-colors">
                        {c.invoiceArchived ? <><FileCheck size={16}/> Désarchiver</> : <><Archive size={16}/> Archiver le cours</>}
                      </button>
                    </div>

                    {classBookings.length === 0 ? <p className="text-sm text-gray-400">Aucun élève inscrit.</p> : (
                      <div className="space-y-2">
                        {classBookings.map(b => {
                          const u = usersInfo[b.userId];
                          return (
                            <div key={b.id} className="flex justify-between items-center bg-white border border-gray-100 p-3 rounded-xl hover:shadow-sm transition-shadow">
                              <div>
                                <p className="font-bold text-gray-800 text-sm">{b.userName.replace(' (Manuel)', '')}</p>
                                <p className="text-xs text-gray-500">{u?.street ? `${u.city}` : 'Adresse manquante'} • Payé via {b.paymentMethod}</p>
                              </div>
                              <button onClick={() => generateInvoicePDF(b, u || null, c)} className="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 p-2 rounded-lg transition-colors font-bold text-xs flex items-center gap-1">
                                <FileText size={14}/> Générer PDF
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

// --- MODALES (Suite) ---
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
        paymentStatus: b.paymentStatus 
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
          <a href={`http://googleusercontent.com/maps.google.com/4{encodeURIComponent(info.locationAddress || info.location)}`} target="_blank" rel="noopener noreferrer" className="flex gap-1.5 items-center hover:text-amber-600 underline transition-colors" title="Ouvrir le GPS">
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

// --- APP & REGLAGES (Suite identique) ---
const AdminSettingsTab = ({ locations, templates, globalSettings }: { locations: StudioLocation[], templates: ClassTemplate[], globalSettings: GlobalSettings }) => {
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddress, setNewLocAddress] = useState('');
  const [newTpl, setNewTpl] = useState({ title: '', loc: locations[0]?.name || '', price: '', cap: 12, desc: '' });
  const [remDays, setRemDays] = useState(globalSettings.reminderDays);

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

  const saveSettings = async () => {
    await setDoc(doc(db, "settings", "general"), { reminderDays: remDays }, { merge: true });
    alert("Paramètres enregistrés !");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 lg:col-span-2">
        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><Settings className="text-gray-500"/> Paramètres Généraux</h3>
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-bold text-gray-800">Délai des relances de paiement</p>
            <p className="text-sm text-gray-500">Nombre de jours après le cours avant qu'un élève ou Pro "Non Payé" apparaisse dans le Tableau de Bord.</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" value={remDays} onChange={e => setRemDays(Number(e.target.value))} className="p-2 border rounded-lg w-20 text-center font-bold"/>
            <span className="text-sm font-bold text-gray-500 mr-2">Jours</span>
            <button onClick={saveSettings} className="bg-gray-800 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-700">Enregistrer</button>
          </div>
        </div>
      </div>

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

// --- 3. MODALES TRANSVERSES ---

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
            <li className="flex items-start gap-2"><XCircle size={16} className="text-red-500 shrink-0 mt-0.5"/> Ne mets pas de crème/huile sur le corps le jour même, tu risques de glisser !</li>
          </ul>
        </div>
        <button onClick={onClose} className="w-full py-3 bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition-colors shadow-lg shadow-green-200">J'ai compris !</button>
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

export default function App() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'planning' | 'history' | 'admin_dashboard' | 'admin_students' | 'admin_past' | 'admin_settings' | 'admin_invoices'>('planning');
  const [classes, setClasses] = useState<DanceClass[]>([]);
  const [pastClasses, setPastClasses] = useState<DanceClass[]>([]);
  const [locations, setLocations] = useState<StudioLocation[]>([]);
  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({ reminderDays: 3 });
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
        } else setLocations(data.locations || []);
        setTemplates(data.templates || []);
        setGlobalSettings({ reminderDays: data.reminderDays !== undefined ? data.reminderDays : 3 });
      } else setDoc(doc(db, "settings", "general"), { locations: [], templates: [], reminderDays: 3 });
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
        const classDoc = await t.get(classRef); const userDoc = await t.get(userRef);
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
        setBookingSuccessOpen(true); fetchAllData();
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
        bookingId = snap.docs[0].id; method = snap.docs[0].data().paymentMethod; pStatus = snap.docs[0].data().paymentStatus;
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
           location: cTarget.location, studentName: `${userProfile.displayName} (${method})`, price: cTarget.price || '', paymentStatus: pStatus 
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
              <button onClick={() => setActiveTab('admin_dashboard')} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold whitespace-nowrap transition-colors ${activeTab === 'admin_dashboard' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                <LayoutDashboard size={18}/> Tableau de Bord
              </button>
              <button onClick={() => setActiveTab('admin_invoices')} className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold whitespace-nowrap transition-colors ${activeTab === 'admin_invoices' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                <FileText size={18}/> Factures
              </button>
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

        {activeTab === 'admin_dashboard' && userProfile?.role === 'admin' && (
          <AdminDashboardTab reminderDays={globalSettings.reminderDays} />
        )}

        {activeTab === 'admin_invoices' && userProfile?.role === 'admin' && (
          <AdminInvoicesTab pastClasses={pastClasses} onRefresh={fetchAllData} />
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
          <AdminSettingsTab locations={locations} templates={templates} globalSettings={globalSettings} />
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
