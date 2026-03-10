import React, { useState, useEffect } from 'react';
import { 
  Calendar, User, MapPin, Plus, Trash2, Zap, Loader2, Edit2, AlertTriangle, 
  Phone, HeartPulse, Wallet, Home, CheckCircle, Clock, History, Users, Archive, ChevronDown, ChevronUp,
  Smartphone, Building, ShoppingBag, XCircle, UserPlus, Settings, Map as MapIcon, FileText, Download, 
  LayoutDashboard, TrendingUp, Briefcase, FileSignature, FileSpreadsheet, CalendarPlus, Bell, Search, Info, Database, Instagram, Code, Palette, Type, Square, MessageSquare, Mail, EyeOff, Ghost
} from 'lucide-react';
import { db, auth } from './lib/firebase'; 
import { 
  collection, getDocs, addDoc, Timestamp, deleteDoc, doc, runTransaction, onSnapshot, setDoc, updateDoc, query, orderBy, where, limit 
} from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import jsPDF from 'jspdf'; 

// --- CONFIGURATION ---
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzxqnW1O5bfVWLQpHuvXkouogYiUugO43jmEAB_QJMadCKfLFNpRXuf7XcZ6fg4ZGDG0w/exec"; 
const GOOGLE_EMAIL_URL = "https://script.google.com/macros/s/AKfycbytPtkOpS6vrQvs6DWYYd2g5XWL5mRZD8dbvxCrUfZhMrK-t4JJHMkv65Av8m8P8hCF/exec";

// --- MODÈLES & TYPES ---
interface StudioLocation { id: string; name: string; address: string; }
interface ClassTemplate { id: string; title: string; locationName: string; price: string; maxCapacity: number; description: string; externalLink?: string; color?: string; }
interface CreditPackTemplate { id: string; name: string; price: number; qty: number; validityDays: number; }
interface GlobalSettings { reminderDays: number; welcomeText?: string; welcomeImageUrl?: string; welcomeTextSize?: number; welcomeImageSize?: number; }
interface ThemeSettings { cardRadius?: string; btnRadius?: string; fontFamily?: string; fontSize?: string; tabHome?: string; tabPlanning?: string; tabHistory?: string; logoUrl?: string; }

interface DanceClass {
  id: string; title: string; description?: string; price: string;
  startAt: Date; endAt: Date; maxCapacity: number; attendeesCount: number;
  attendeeIds: string[]; instructor: string; location: string; locationAddress?: string; invoiceArchived?: boolean; externalLink?: string; color?: string;
}

interface UserProfile {
  id: string; email: string; displayName: string; role: 'student' | 'admin' | 'dev-admin';
  birthDate?: string; street?: string; zipCode?: string; city?: string; phone?: string; emergencyContact?: string; emergencyPhone?: string;
  hasFilledForm?: boolean; imageRights?: 'yes' | 'no'; adminMemo?: string; credits?: number; pendingPopup?: string;
  creditPacks?: { id: string; qty: number; remaining: number; expiresAt: string; }[];
}

interface BookingInfo {
  id: string; classId: string; userId: string; userName: string; classTitle: string; date: string; dateStr: string; timeStr: string; location: string; price: string;
  paymentMethod: 'CREDIT' | 'CASH' | 'WERO_RIB'; paymentStatus: 'PAID' | 'PENDING'; paidAt?: string; updatedAt?: string; invoiceDownloaded?: boolean;
}

interface CreditPurchase {
  id: string; userId: string; userName: string; packId: string; packName: string; qty: number; price: number; validityDays: number;
  date: string; paymentMethod: 'WERO_RIB'; status: 'PENDING' | 'PAID'; paidAt?: string;
}

interface ProClient { id: string; name: string; address: string; siret?: string; }
interface B2BInvoiceItem { desc: string; qty: number; price: number; total?: number; }
interface B2BInvoice {
  id: string; clientId: string; clientName: string; date: string; items?: B2BInvoiceItem[]; desc?: string; qty?: number; price?: number; total: number;
  status: 'DEVIS' | 'FACTURE'; paymentStatus: 'PENDING' | 'PAID'; paymentMethod: 'ESPECE' | 'VIREMENT_RIB' | 'WERO_PAYPAL'; paidAt?: string; updatedAt?: string;
}

interface AppNotification { id: string; text: string; date: string; read: boolean; type: 'BOOKING' | 'CANCEL' | 'BOUTIQUE' | 'NEW_STUDENT'; }
type PaymentMethod = 'CREDIT' | 'CASH' | 'WERO_RIB';

// --- FONCTIONS UTILITAIRES ---
const syncToSheet = async (payload: any) => {
  if (GOOGLE_SCRIPT_URL.includes("TA_NOUVELLE_URL") || GOOGLE_SCRIPT_URL.includes("TA_URL_GOOGLE")) return; 
  try {
    const actionDate = new Date().toLocaleString('fr-FR'); const enrichedPayload = { actionDate, ...payload };
    if (payload.type === 'BOOKING') enrichedPayload.sheetName = payload.paymentStatus === 'PAID' ? 'Payer' : 'NON PAYÉ';
    await fetch(GOOGLE_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enrichedPayload) });
  } catch (e) {}
};

const sendNotification = async (text: string, type: 'BOOKING' | 'CANCEL' | 'BOUTIQUE' | 'NEW_STUDENT') => {
  try { 
    // 1. Notification interne sur le site
    await addDoc(collection(db, "notifications"), { text, date: new Date().toISOString(), read: false, type }); 
    
    // 2. Envoi silencieux de l'email via Google Script
    if (typeof GOOGLE_EMAIL_URL !== 'undefined' && !GOOGLE_EMAIL_URL.includes("COLLE_TON_URL")) {
      fetch(GOOGLE_EMAIL_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, type })
      }).catch(e => console.log("Erreur silencieuse email:", e));
    }
  } catch (e) {}
};

const formatForInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const generateGoogleCalendarLink = (title: string, start: Date, end: Date, location: string, desc: string) => {
  const formatDT = (date: Date) => date.toISOString().replace(/-|:|\.\d+/g, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${formatDT(start)}/${formatDT(end)}&details=${encodeURIComponent(desc)}&location=${encodeURIComponent(location)}`;
};
const getActiveCredits = (user: UserProfile | null) => {
  if (!user || !user.creditPacks) return 0;
  const now = new Date().getTime(); return user.creditPacks.filter(p => new Date(p.expiresAt).getTime() > now).reduce((sum, p) => sum + p.remaining, 0);
};

// --- FONCTIONS GENERATION PDF ---
const getBase64ImageFromUrl = async (imageUrl: string) => {
  return new Promise<string>((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'Anonymous';
    img.onload = () => { const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d'); if (ctx) { ctx.drawImage(img, 0, 0); resolve(canvas.toDataURL('image/png')); } else reject('Canvas error'); };
    img.onerror = reject; img.src = imageUrl + '?t=' + new Date().getTime();
  });
};

const renderInvoiceBase = async (doc: jsPDF, typeDoc: string, invNumber: string, dateStr: string, clientName: string, clientAddress: string, clientSiret?: string) => {
  try { const logoBase64 = await getBase64ImageFromUrl('/logo.png'); doc.addImage(logoBase64, 'PNG', 15, 15, 35, 35); } catch (e) { doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.text("Vertic'Ali", 15, 25); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(236, 214, 120); doc.text(typeDoc, 150, 25); 
  doc.setTextColor(0, 0, 0); doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(`N° ${typeDoc.toLowerCase()}`, 150, 35); doc.setFont("helvetica", "normal"); doc.text(invNumber, 150, 40);
  doc.setFont("helvetica", "bold"); doc.text("Date", 150, 50); doc.setFont("helvetica", "normal"); doc.text(dateStr, 150, 55);
  doc.setFont("helvetica", "bold"); doc.text("Facturé à :", 15, 60); doc.setFont("helvetica", "normal"); doc.text(clientName, 15, 65);
  if (clientAddress) { const splitAddress = doc.splitTextToSize(clientAddress, 80); doc.text(splitAddress, 15, 70); } else { doc.text("Adresse non renseignée", 15, 70); }
  if (clientSiret) { doc.text(`N° SIRET : ${clientSiret}`, 15, 85); }
  doc.setFillColor(236, 214, 120); doc.rect(15, 95, 180, 8, 'F'); doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold");
  doc.text("Description", 20, 100.5); doc.text("Qté", 110, 100.5); doc.text("Prix unitaire", 130, 100.5); doc.text("TVA (%)", 155, 100.5); doc.text("Montant HT", 175, 100.5);
  doc.setTextColor(0, 0, 0); 
};

const renderInvoiceFooter = (doc: jsPDF, totalStr: string, totalsY: number = 130) => {
  doc.setDrawColor(200); doc.line(15, totalsY, 195, totalsY); 
  doc.setFont("helvetica", "bold"); doc.text("Total HT", 140, totalsY + 10); doc.text("TVA", 140, totalsY + 17); doc.text("Total TTC", 140, totalsY + 27);
  doc.setFont("helvetica", "normal"); doc.text(totalStr, 175, totalsY + 10); doc.text("0,00 €", 175, totalsY + 17); doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0); doc.text(totalStr, 175, totalsY + 27);
  doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
  const topLines = [ "TVA non applicable selon l'article 293B du code général des impôts.", "Pas d'escompte accordé pour paiement anticipé.", "En cas de non-paiement à la date d'échéance, des pénalités calculées à trois fois le taux d'intérêt légal seront appliquées.", "Tout retard de paiement entraînera une indemnité forfaitaire pour frais de recouvrement de 40€." ];
  let y = 238; topLines.forEach(line => { doc.text(line, 105, y, { align: "center" }); y += 4; });
  y += 3; doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
  doc.text("RIB pour paiement par virement: FR2120041010052736887X02624 - BIC: PSSTFRPPLIL", 105, y, { align: "center" });
  doc.setFillColor(236, 214, 120); doc.rect(0, 268, 210, 30, 'F'); doc.setTextColor(0, 0, 0);
  const greenLines = [ "Vertic'Ali - Alison BOUTELEUX - Entreprise individuelle", "18 rue Maurice Domon, Appt C22, 80000 AMIENS", "Tél: 06.21.05.64.14 - Mail: verticali.poledance@gmail.com", "SIRET: 94819885800029" ];
  y = 275; greenLines.forEach(line => { doc.text(line, 105, y, { align: "center" }); y += 5; });
};

const getB2CInvoiceIndex = async (targetId: string, invoiceDate: Date) => {
  const yyyy = invoiceDate.getFullYear(); const mm = String(invoiceDate.getMonth() + 1).padStart(2, '0');
  const [snapB, snapP] = await Promise.all([ getDocs(query(collection(db, "bookings"), where("paymentStatus", "==", "PAID"))), getDocs(query(collection(db, "credit_purchases"), where("status", "==", "PAID"))) ]);
  const b = snapB.docs.map(d=>({id: d.id, ...d.data()})).filter((x:any) => x.paymentMethod !== 'CREDIT');
  const p = snapP.docs.map(d=>({id: d.id, ...d.data()}));
  const all = [...b, ...p].filter((x:any) => { const d = x.paidAt ? new Date(x.paidAt) : new Date(x.date); return d.getFullYear() === yyyy && String(d.getMonth() + 1).padStart(2, '0') === mm; }).sort((a:any, b:any) => { const da = a.paidAt ? new Date(a.paidAt) : new Date(a.date); const db = b.paidAt ? new Date(b.paidAt) : new Date(b.date); return da.getTime() - db.getTime(); });
  let index = all.findIndex(x => x.id === targetId) + 1; if (index === 0) index = all.length + 1;
  return `FAC-${yyyy}${mm}-${String(index).padStart(3, '0')}`;
};

const generateInvoicePDF = async (booking: BookingInfo, studentProfile: UserProfile | null, classInfo: { title: string, startAt: Date, price?: string }) => {
  const invoiceDate = booking.paidAt ? new Date(booking.paidAt) : new Date(booking.date);
  const invNumber = await getB2CInvoiceIndex(booking.id, invoiceDate);
  const doc = new jsPDF(); const dateStr = invoiceDate.toLocaleDateString('fr-FR'); const editionDateStr = dateStr.replace(/\//g,'-');
  const clientName = booking.userName.replace(" (Manuel)", ""); const address = studentProfile?.street ? `${studentProfile.street}\n${studentProfile.zipCode || ''} ${studentProfile.city || ''}` : '';
  await renderInvoiceBase(doc, "FACTURE", invNumber, dateStr, clientName, address);
  let rawPrice = classInfo.price || booking.price || '0'; rawPrice = rawPrice.replace('€', '').replace('Crédit', '').replace('crédit', '').trim(); if (isNaN(Number(rawPrice))) rawPrice = "0"; const priceVal = `${rawPrice},00 €`;
  doc.setFont("helvetica", "normal"); doc.text(`Cours : ${classInfo.title}`, 20, 110); doc.setFontSize(8); doc.text(`Le ${classInfo.startAt.toLocaleDateString('fr-FR')} à ${classInfo.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}`, 20, 115); doc.setFontSize(10); doc.text("1", 112, 110); doc.text(priceVal, 130, 110); doc.text("0", 160, 110); doc.text(priceVal, 175, 110);
  renderInvoiceFooter(doc, priceVal); doc.save(`Facture_${clientName.replace(/\s+/g, '_')}_${editionDateStr}.pdf`);
};

const generatePackInvoicePDF = async (purchase: CreditPurchase, studentProfile: UserProfile | null) => {
  const invoiceDate = purchase.paidAt ? new Date(purchase.paidAt) : new Date(purchase.date);
  const invNumber = await getB2CInvoiceIndex(purchase.id, invoiceDate);
  const doc = new jsPDF(); const dateStr = invoiceDate.toLocaleDateString('fr-FR'); const editionDateStr = dateStr.replace(/\//g,'-');
  const clientName = purchase.userName; const address = studentProfile?.street ? `${studentProfile.street}\n${studentProfile.zipCode || ''} ${studentProfile.city || ''}` : '';
  await renderInvoiceBase(doc, "FACTURE", invNumber, dateStr, clientName, address);
  const priceVal = `${purchase.price.toFixed(2).replace('.', ',')} €`;
  doc.setFont("helvetica", "normal"); doc.text(`Boutique : ${purchase.packName} (${purchase.qty} crédits)`, 20, 110); doc.text("1", 112, 110); doc.text(priceVal, 130, 110); doc.text("0", 160, 110); doc.text(priceVal, 175, 110);
  renderInvoiceFooter(doc, priceVal); doc.save(`Facture_Boutique_${clientName.replace(/\s+/g, '_')}_${editionDateStr}.pdf`);
};

const generateB2BInvoicePDF = async (invoice: B2BInvoice, client: ProClient) => {
  const invoiceDate = new Date(invoice.date); const yyyy = invoiceDate.getFullYear(); const mm = String(invoiceDate.getMonth() + 1).padStart(2, '0');
  const typeDoc = invoice.status === 'DEVIS' ? 'DEVIS' : 'FACTURE'; const prefix = invoice.status === 'DEVIS' ? 'DEV' : 'FAC-PRO';
  const snap = await getDocs(query(collection(db, "b2b_invoices"), where("status", "==", invoice.status)));
  const monthInvoices = snap.docs.map(d => ({ id: d.id, ...d.data() } as B2BInvoice)).filter(i => { const d = new Date(i.date); return d.getFullYear() === yyyy && String(d.getMonth() + 1).padStart(2, '0') === mm; }).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let index = monthInvoices.findIndex(i => i.id === invoice.id) + 1; if (index === 0) index = monthInvoices.length + 1;
  const invNumber = `${prefix}-${yyyy}${mm}-${String(index).padStart(3, '0')}`;

  const doc = new jsPDF(); const dateStr = invoiceDate.toLocaleDateString('fr-FR'); const editionDateStr = dateStr.replace(/\//g,'-');
  await renderInvoiceBase(doc, typeDoc, invNumber, dateStr, client.name, client.address, client.siret);
  
  const itemsToDraw = invoice.items && invoice.items.length > 0 ? invoice.items : [{ desc: invoice.desc || '', qty: invoice.qty || 1, price: invoice.price || 0 }];
  let startY = 110; doc.setFont("helvetica", "normal");
  itemsToDraw.forEach(item => {
    const splitDesc = doc.splitTextToSize(item.desc, 85);
    doc.text(splitDesc, 20, startY); doc.text(item.qty.toString(), 112, startY);
    doc.text(`${item.price.toFixed(2).replace('.', ',')} €`, 130, startY); doc.text("0", 160, startY);
    doc.text(`${(item.qty * item.price).toFixed(2).replace('.', ',')} €`, 175, startY);
    startY += (splitDesc.length * 5) + 3;
  });
  const totalVal = `${invoice.total.toFixed(2).replace('.', ',')} €`;
  renderInvoiceFooter(doc, totalVal, Math.max(130, startY + 5)); 
  doc.save(`${typeDoc}_PRO_${client.name.replace(/\s+/g, '_')}_${editionDateStr}.pdf`);
};

// --- COMPOSANTS ADMIN ---
const AdminDashboardTab = ({ reminderDays, today }: { reminderDays: number, today: Date }) => {
  const [stats, setStats] = useState({ caMonthB2C: 0, caMonthB2B: 0, caYearB2C: 0, caYearB2B: 0, pendingCount: 0 });
  const [reminders, setReminders] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [exportStartDate, setExportStartDate] = useState(''); const [exportEndDate, setExportEndDate] = useState(''); const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const fetchDashboardData = async () => {
      const currentYear = today.getFullYear(); const firstDayOfMonth = new Date(currentYear, today.getMonth(), 1); const firstDayOfYear = new Date(currentYear, 0, 1);
      let caMB2C = 0; let caMB2B = 0; let caYB2C = 0; let caYB2B = 0; let lateItems: any[] = [];
      const snapB2C = await getDocs(query(collection(db, "bookings")));
      snapB2C.docs.forEach(d => {
        const b = { id: d.id, ...d.data() } as BookingInfo; const accDate = b.paidAt ? new Date(b.paidAt) : new Date(b.date); 
        if (b.paymentStatus === 'PAID' && b.paymentMethod !== 'CREDIT') { let priceNum = Number((b.price || '0').replace('€', '').replace('Crédit', '').trim()); if (!isNaN(priceNum)) { if (accDate >= firstDayOfMonth) caMB2C += priceNum; if (accDate >= firstDayOfYear) caYB2C += priceNum; } }
        if (b.paymentStatus === 'PENDING') { const diffDays = Math.ceil((today.getTime() - accDate.getTime()) / (1000 * 60 * 60 * 24)); if (diffDays >= reminderDays && accDate < today) lateItems.push({ id: b.id, name: b.userName.replace(' (Manuel)', ''), desc: `${b.classTitle} du ${new Date(b.date).toLocaleDateString('fr-FR')}`, price: b.price || '?', method: b.paymentMethod, type: 'Élève', dateObj: accDate }); }
      });
      const snapBoutique = await getDocs(query(collection(db, "credit_purchases")));
      snapBoutique.docs.forEach(d => {
        const p = d.data() as CreditPurchase; const accDate = p.paidAt ? new Date(p.paidAt) : new Date(p.date);
        if (p.status === 'PAID') { if (accDate >= firstDayOfMonth) caMB2C += p.price; if (accDate >= firstDayOfYear) caYB2C += p.price; }
        if (p.status === 'PENDING') { const diffDays = Math.ceil((today.getTime() - accDate.getTime()) / (1000 * 60 * 60 * 24)); if (diffDays >= reminderDays && accDate < today) lateItems.push({ id: d.id, name: p.userName, desc: `Boutique : ${p.packName}`, price: `${p.price} €`, method: p.paymentMethod, type: 'Boutique', dateObj: accDate }); }
      });
      const snapB2B = await getDocs(query(collection(db, "b2b_invoices")));
      snapB2B.docs.forEach(d => {
        const b = { id: d.id, ...d.data() } as B2BInvoice; const accDate = b.paidAt ? new Date(b.paidAt) : new Date(b.date);
        if (b.status === 'FACTURE' && b.paymentStatus === 'PAID') { if (accDate >= firstDayOfMonth) caMB2B += b.total; if (accDate >= firstDayOfYear) caYB2B += b.total; }
        if (b.status === 'FACTURE' && b.paymentStatus === 'PENDING') { const diffDays = Math.ceil((today.getTime() - accDate.getTime()) / (1000 * 60 * 60 * 24)); if (diffDays >= reminderDays && accDate < today) lateItems.push({ id: b.id, name: b.clientName, desc: `Prestation PRO : ${b.desc || ''}`, price: `${b.total} €`, method: b.paymentMethod, type: 'PRO', dateObj: accDate }); }
      });
      setStats({ caMonthB2C: caMB2C, caMonthB2B: caMB2B, caYearB2C: caYB2C, caYearB2B: caYB2B, pendingCount: lateItems.length }); setReminders(lateItems.sort((a,b) => b.dateObj.getTime() - a.dateObj.getTime())); setLoading(false);
    }; fetchDashboardData();
  }, [reminderDays, today]);

  const handleExportCSV = async (start: Date, end: Date, periodName: string) => {
    setIsExporting(true);
    try {
      const endOfDay = new Date(end); endOfDay.setHours(23, 59, 59, 999); let exportRows: any[] = [];
      const snapB2C = await getDocs(query(collection(db, "bookings"), where("paymentStatus", "==", "PAID"))); snapB2C.docs.forEach(d => { const b = d.data() as BookingInfo; if (b.paymentMethod === 'CREDIT') return; const accDate = b.paidAt ? new Date(b.paidAt) : new Date(b.date); if (accDate >= start && accDate <= endOfDay) { let priceNum = Number((b.price || '0').replace('€', '').trim()); if (!isNaN(priceNum) && priceNum > 0) exportRows.push({ dateObj: accDate, dateStr: accDate.toLocaleString('fr-FR'), type: 'B2C (Cours)', client: b.userName.replace(' (Manuel)', ''), desc: b.classTitle, method: b.paymentMethod, amount: priceNum }); } });
      const snapBoutique = await getDocs(query(collection(db, "credit_purchases"), where("status", "==", "PAID"))); snapBoutique.docs.forEach(d => { const p = d.data() as CreditPurchase; const accDate = p.paidAt ? new Date(p.paidAt) : new Date(p.date); if (accDate >= start && accDate <= endOfDay) exportRows.push({ dateObj: accDate, dateStr: accDate.toLocaleString('fr-FR'), type: 'B2C (Boutique)', client: p.userName, desc: p.packName, method: p.paymentMethod, amount: p.price }); });
      const snapB2B = await getDocs(query(collection(db, "b2b_invoices"), where("status", "==", "FACTURE"), where("paymentStatus", "==", "PAID"))); snapB2B.docs.forEach(d => { const b = d.data() as B2BInvoice; const accDate = b.paidAt ? new Date(b.paidAt) : new Date(b.date); if (accDate >= start && accDate <= endOfDay) exportRows.push({ dateObj: accDate, dateStr: accDate.toLocaleString('fr-FR'), type: 'B2B (PRO)', client: b.clientName, desc: b.desc || 'Prestation', method: b.paymentMethod, amount: b.total }); });
      exportRows.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
      let csvContent = "Date de Paiement;Type de Client;Nom du Client;Description;Moyen de Paiement;Montant (EUR)\n"; let totalAmount = 0;
      exportRows.forEach(r => { const safeDesc = r.desc.replace(/"/g, '""').replace(/\n/g, ' '); const safeClient = r.client.replace(/"/g, '""'); csvContent += `${r.dateStr};${r.type};"${safeClient}";"${safeDesc}";${r.method};${r.amount}\n`; totalAmount += r.amount; });
      csvContent += `;;;;TOTAL;${totalAmount}\n`;
      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob)); link.setAttribute("download", `Export_URSSAF_${periodName}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } catch (error) { alert("Erreur export."); } setIsExporting(false);
  };
  const exportCurrentMonth = () => { handleExportCSV(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0), `Mois_${today.getMonth()+1}_${today.getFullYear()}`); };
  const exportCustomPeriod = () => { if (!exportStartDate || !exportEndDate) return alert("Dates requises."); const start = new Date(exportStartDate); const end = new Date(exportEndDate); if (start > end) return; handleExportCSV(start, end, `Periode_${exportStartDate}_au_${exportEndDate}`); };
  
  if (loading) return <div className="text-center p-10"><Loader2 className="animate-spin inline mr-2"/></div>;

  return (
    <div className="space-y-8 text-left">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6"><div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 theme-card"><div className="flex items-center gap-4 mb-4"><div className="p-3 bg-green-50 text-green-600 rounded-xl theme-btn"><TrendingUp size={24}/></div><p className="font-bold text-gray-500 uppercase">CA Élèves</p></div><p className="text-3xl font-black text-gray-800">{stats.caMonthB2C} € <span className="text-sm font-normal text-gray-400">/ mois</span></p><p className="text-sm font-bold text-gray-400 mt-2">Année : {stats.caYearB2C} €</p></div><div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 theme-card"><div className="flex items-center gap-4 mb-4"><div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl theme-btn"><Briefcase size={24}/></div><p className="font-bold text-gray-500 uppercase">CA PRO</p></div><p className="text-3xl font-black text-gray-800">{stats.caMonthB2B} € <span className="text-sm font-normal text-gray-400">/ mois</span></p><p className="text-sm font-bold text-gray-400 mt-2">Année : {stats.caYearB2B} €</p></div><div className="bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-700 theme-card"><div className="flex items-center gap-4 mb-4"><div className="p-3 bg-amber-500 text-gray-900 rounded-xl theme-btn"><Wallet size={24}/></div><p className="font-bold text-gray-400 uppercase">CA TOTAL</p></div><p className="text-3xl font-black text-white">{stats.caMonthB2C + stats.caMonthB2B} € <span className="text-sm font-normal text-gray-500">/ mois</span></p><p className="text-sm font-bold text-amber-500 mt-2">Année : {stats.caYearB2C + stats.caYearB2B} €</p></div></div>
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 ring-4 ring-indigo-50 p-6 theme-card"><div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6"><div className="flex items-center gap-3"><div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl theme-btn"><FileSpreadsheet size={24}/></div><div><h3 className="font-bold text-indigo-900 text-lg">Export Comptable URSSAF</h3><p className="text-sm text-indigo-700/70 font-medium">Téléchargez les recettes.</p></div></div><button onClick={exportCurrentMonth} disabled={isExporting} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex gap-2 theme-btn">{isExporting ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>} Export du Mois</button></div><div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 theme-card"><span className="text-sm font-bold text-gray-600">Période :</span><input type="date" value={exportStartDate} onChange={e=>setExportStartDate(e.target.value)} className="p-2 border rounded-lg text-sm theme-btn" /> à <input type="date" value={exportEndDate} onChange={e=>setExportEndDate(e.target.value)} className="p-2 border rounded-lg text-sm theme-btn" /><button onClick={exportCustomPeriod} disabled={isExporting || !exportStartDate || !exportEndDate} className="bg-white border border-gray-300 px-4 py-2 rounded-lg font-bold text-sm theme-btn">Exporter</button></div></div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden theme-card"><div className="p-5 border-b border-gray-200 bg-gray-50 flex items-center gap-2"><AlertTriangle className="text-orange-500"/><h3 className="font-bold text-gray-800 text-lg">Retards de paiement (&gt; {reminderDays} j)</h3></div><div className="p-5">{reminders.length === 0 ? <p className="text-gray-500">Aucun retard.</p> : (<div className="space-y-3">{reminders.map(r => (<div key={r.id} className="flex justify-between items-center bg-white p-4 rounded-xl border border-red-100 shadow-sm theme-card"><div><div className="flex items-center gap-2 mb-1"><span className={`text-[10px] font-black px-2 py-0.5 rounded-md theme-btn ${r.type === 'PRO' ? 'bg-indigo-100 text-indigo-700' : 'bg-green-100 text-green-700'}`}>{r.type}</span><p className="font-bold text-gray-800">{r.name}</p></div><p className="text-xs text-gray-500">{r.desc}</p></div><div className="text-right"><p className="font-bold text-red-600">{r.price}</p><p className="text-xs text-gray-400">Via {r.method}</p></div></div>))}</div>)}</div></div>
    </div>
  );
};

const AdminTodayTab = ({ classes, users, today, bookings }: { classes: DanceClass[], users: UserProfile[], today: Date, bookings: BookingInfo[] }) => {
  const todayStr = today.toLocaleDateString('fr-FR');
  const todayClasses = classes.filter(c => new Date(c.startAt).toLocaleDateString('fr-FR') === todayStr).sort((a,b) => a.startAt.getTime() - b.startAt.getTime());

  const togglePayment = async (bookingId: string, currentStatus: string, bookingData: any) => {
    const newStatus = currentStatus === 'PAID' ? 'PENDING' : 'PAID';
    const nowStr = new Date().toISOString();
    await updateDoc(doc(db, "bookings", bookingId), { paymentStatus: newStatus, updatedAt: nowStr, paidAt: newStatus === 'PAID' ? nowStr : null });
    syncToSheet({ type: 'BOOKING_UPDATE', classId: bookingData.classId, classTitle: bookingData.classTitle, date: bookingData.dateStr, time: bookingData.timeStr, location: bookingData.location || '', studentId: bookingData.userId, studentName: `${bookingData.userName} (${bookingData.paymentMethod})`, paymentStatus: newStatus, price: bookingData.price });
  };

  return (
    <div className="space-y-6 text-left">
      <h2 className="text-2xl font-black text-gray-900 flex items-center gap-2 mb-2"><Clock className="text-amber-500"/> Cours d'aujourd'hui</h2>
      {todayClasses.length === 0 ? <p className="text-gray-500 bg-white p-10 rounded-2xl text-center theme-card border">Aucun cours prévu aujourd'hui.</p> : todayClasses.map(c => {
        const classUsers = users.filter(u => c.attendeeIds?.includes(u.id));
        const phones = classUsers.map(u => u.phone).filter(Boolean);
        const emails = classUsers.map(u => u.email).filter(Boolean);
        return (
          <div key={c.id} className="bg-white border-2 border-amber-200 rounded-2xl shadow-sm theme-card overflow-hidden">
            <div className="p-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center">
              <div><h3 className="font-bold text-amber-900">{c.title}</h3><p className="text-xs text-amber-700">{c.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})} - {c.location}</p></div>
              <span className="bg-amber-200 text-amber-900 text-[10px] font-black px-2 py-1 rounded-lg theme-btn uppercase">{c.attendeesCount} / {c.maxCapacity} inscrits</span>
            </div>
            <div className="p-2 space-y-1">
              {c.attendeeIds?.length === 0 && <p className="text-xs text-gray-400 p-2 text-center">Aucun inscrit pour le moment</p>}
              {classUsers.map(student => {
                const b = bookings.find(x => x.classId === c.id && x.userId === student.id);
                return (
                  <div key={student.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 theme-card transition-colors border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-800 text-sm">{student.displayName}</span>
                      {student.imageRights === 'no' && <span title="REFUS DROIT À L'IMAGE" className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-md font-black theme-btn animate-pulse shadow-sm">⚠️ IMAGE</span>}
                      {!student.hasFilledForm && <span title="Fiche non remplie" className="bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-md font-black theme-btn">FICHE MANQUANTE</span>}
                    </div>
                    <div className="flex gap-3 items-center">
                       <span className="text-[10px] text-gray-400 font-bold uppercase hidden md:block">{student.phone || 'Pas de tél'}</span>
                       {b && (
                          <div className="flex items-center gap-2">
                             <span className="text-[10px] font-bold text-gray-500 hidden sm:block">{b.paymentMethod}</span>
                             <button onClick={() => togglePayment(b.id, b.paymentStatus, b)} disabled={b.paymentMethod === 'CREDIT'} className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg font-bold text-xs min-w-[85px] theme-btn ${b.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                               {b.paymentStatus === 'PAID' ? <><CheckCircle size={14}/> Payé</> : <><Clock size={14}/> À régler</>}
                             </button>
                          </div>
                       )}
                    </div>
                  </div>
                );
              })}
            </div>
            {classUsers.length > 0 && (
              <div className="flex gap-2 p-3 bg-gray-50 border-t border-gray-100">
                <button onClick={() => {navigator.clipboard.writeText(phones.join(', ')); alert("Numéros copiés dans le presse-papier !");}} className="flex-1 bg-white border border-gray-300 py-2 rounded-lg text-xs font-bold flex justify-center gap-1.5 text-gray-700 hover:bg-gray-100 theme-btn"><MessageSquare size={14}/> Copier SMS</button>
                <a href={`mailto:?bcc=${emails.join(',')}&subject=Cours Vertic'Ali : ${c.title}`} className="flex-1 bg-white border border-gray-300 py-2 rounded-lg text-xs font-bold flex justify-center gap-1.5 text-gray-700 hover:bg-gray-100 theme-btn"><Mail size={14}/> Email Groupé</a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const AdminBoutiqueTab = () => {
  const [purchases, setPurchases] = useState<CreditPurchase[]>([]);
  useEffect(() => { const unsub = onSnapshot(query(collection(db, "credit_purchases"), orderBy("date", "desc")), (snap) => setPurchases(snap.docs.map(d => ({id: d.id, ...d.data()} as CreditPurchase)))); return () => unsub(); }, []);
  const validatePurchase = async (p: CreditPurchase) => { if(!window.confirm(`Valider le paiement de ${p.price}€ et ajouter ${p.qty} crédits à ${p.userName} ?`)) return; try { const userSnap = await getDocs(query(collection(db, "users"), where("__name__", "==", p.userId))); if (userSnap.empty) return; const userData = userSnap.docs[0].data() as UserProfile; const nowStr = new Date().toISOString(); const expires = new Date(); expires.setDate(expires.getDate() + p.validityDays); await updateDoc(doc(db, "users", p.userId), { creditPacks: [...(userData.creditPacks || []), { id: p.id, qty: p.qty, remaining: p.qty, expiresAt: expires.toISOString() }] }); await updateDoc(doc(db, "credit_purchases", p.id), { status: 'PAID', paidAt: nowStr }); syncToSheet({ type: 'CREDIT_PURCHASE', id: p.id, packName: p.packName, date: new Date().toLocaleDateString('fr-FR'), price: p.price, studentName: p.userName, studentId: p.userId }); alert("Crédits ajoutés avec succès !"); } catch (e) { alert("Erreur."); } };
  const handleCancelPurchase = async (id: string) => { if (!window.confirm("Supprimer cette commande en attente ?")) return; try { await deleteDoc(doc(db, "credit_purchases", id)); } catch(e) { alert("Erreur lors de l'annulation."); } };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 text-left theme-card">
      <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><ShoppingBag className="text-amber-500"/> Commandes de Crédits</h3>
      {purchases.length === 0 ? <p className="text-gray-500">Aucune commande.</p> : (<div className="space-y-4">{purchases.map(p => (<div key={p.id} className={`flex justify-between items-center p-4 rounded-xl border theme-card ${p.status === 'PENDING' ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'}`}><div><p className="font-bold text-gray-800">{p.userName} <span className="text-xs font-normal text-gray-500 ml-2">{new Date(p.date).toLocaleString('fr-FR')}</span></p><p className="text-sm text-gray-600">{p.packName} ({p.qty} cr.) - {p.price}€</p></div>{p.status === 'PENDING' ? (<div className="flex items-center gap-2"><button onClick={() => validatePurchase(p)} className="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg font-bold text-sm flex gap-1 theme-btn"><CheckCircle size={16}/> Valider</button><button onClick={() => handleCancelPurchase(p.id)} className="bg-red-50 hover:bg-red-100 text-red-500 p-1.5 rounded-lg theme-btn"><Trash2 size={16}/></button></div>) : <span className="text-xs font-bold text-gray-400 bg-gray-200 px-3 py-1 rounded-md theme-btn">Activé le {new Date(p.paidAt!).toLocaleDateString('fr-FR')}</span>}</div>))}</div>)}
    </div>
  );
};

const AdminInvoicesTab = ({ today }: { today: Date }) => {
  const [viewMode, setViewMode] = useState<'PENDING' | 'ARCHIVED' | 'BOUTIQUE' | 'B2B'>('PENDING');
  const [allBookings, setAllBookings] = useState<BookingInfo[]>([]); const [usersInfo, setUsersInfo] = useState<{ [key: string]: UserProfile }>({});
  const [proClients, setProClients] = useState<ProClient[]>([]); const [b2bInvoices, setB2bInvoices] = useState<B2BInvoice[]>([]);
  const [newProClient, setNewProClient] = useState<Partial<ProClient>>({}); const [editingProId, setEditingProId] = useState<string | null>(null);
  const [b2bInvoiceData, setB2bInvoiceData] = useState<{clientId: string, items: B2BInvoiceItem[]}>({ clientId: '', items: [{desc: '', qty: 1, price: 0}] }); 
  const [editingB2bId, setEditingB2bId] = useState<string | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      const uSnap = await getDocs(collection(db, "users")); const usersMap: any = {}; uSnap.docs.forEach(d => { usersMap[d.id] = { id: d.id, ...d.data() }; }); setUsersInfo(usersMap);
      const pSnap = await getDocs(collection(db, "pro_clients")); setProClients(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProClient)));
      onSnapshot(query(collection(db, "bookings")), snap => setAllBookings(snap.docs.map(d => ({id: d.id, ...d.data()} as BookingInfo))));
      onSnapshot(query(collection(db, "b2b_invoices"), orderBy("date", "desc")), snap => setB2bInvoices(snap.docs.map(d => ({id: d.id, ...d.data()} as B2BInvoice))));
    }; fetchAll();
  }, []);

  const pendingGroups: any = {}; const archivedGroups: any = {}; const nowTime = today.getTime();
  allBookings.forEach(b => { if (b.paymentMethod === 'CREDIT') return; const isPast = new Date(b.date).getTime() < nowTime; const needsAction = (b.paymentStatus === 'PENDING') || (b.paymentStatus === 'PAID' && !b.invoiceDownloaded); const targetGroup = needsAction ? pendingGroups : archivedGroups; if(!targetGroup[b.classId]) targetGroup[b.classId] = { classId: b.classId, classTitle: b.classTitle, date: b.date, bookings: [] }; targetGroup[b.classId].bookings.push({ ...b, isPast }); });
  const pendingClasses = Object.values(pendingGroups).sort((a:any,b:any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const archivedClasses = Object.values(archivedGroups).sort((a:any,b:any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const classesToDisplay = viewMode === 'PENDING' ? pendingClasses : archivedClasses;

  const handleAddProClient = async (e: React.FormEvent) => { e.preventDefault(); if (!newProClient.name || !newProClient.address) return; if (editingProId) { await updateDoc(doc(db, "pro_clients", editingProId), newProClient); setEditingProId(null); } else { await addDoc(collection(db, "pro_clients"), newProClient); } setNewProClient({ name: '', address: '', siret: '' }); const snap = await getDocs(collection(db, "pro_clients")); setProClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProClient))); };
  const handleDeleteProClient = async (id: string) => { if (!confirm("Supprimer ce client ?")) return; await deleteDoc(doc(db, "pro_clients", id)); setProClients(proClients.filter(c => c.id !== id)); };
  const handleCreateDevis = async (e: React.FormEvent) => { e.preventDefault(); const client = proClients.find(c => c.id === b2bInvoiceData.clientId); if (!client || b2bInvoiceData.items.length === 0 || b2bInvoiceData.items.some(i => !i.desc || i.qty <= 0 || i.price < 0)) return alert("Champs invalides."); const nowStr = new Date().toISOString(); const total = b2bInvoiceData.items.reduce((sum, item) => sum + (item.qty * item.price), 0); const payload = { clientId: client.id, clientName: client.name, items: b2bInvoiceData.items, total, updatedAt: nowStr, desc: b2bInvoiceData.items[0].desc }; if (editingB2bId) { await updateDoc(doc(db, "b2b_invoices", editingB2bId), payload); setEditingB2bId(null); } else { await addDoc(collection(db, "b2b_invoices"), { ...payload, date: nowStr, status: 'DEVIS', paymentStatus: 'PENDING', paymentMethod: 'VIREMENT_RIB' }); } setB2bInvoiceData({ clientId: '', items: [{desc: '', qty: 1, price: 0}] }); };
  const handleDeleteB2b = async (id: string) => { if (confirm("Supprimer cette prestation ?")) await deleteDoc(doc(db, "b2b_invoices", id)); };
  const handleB2BAction = async (invoice: B2BInvoice, action: 'TO_FACTURE' | 'TOGGLE_PAYMENT' | 'CHANGE_METHOD', newVal?: string) => { const ref = doc(db, "b2b_invoices", invoice.id); let updates: any = {}; const nowStr = new Date().toISOString(); if (action === 'TO_FACTURE') { if(!confirm("Transformer ce Devis en Facture ?")) return; updates = { status: 'FACTURE', date: nowStr, updatedAt: nowStr }; } else if (action === 'TOGGLE_PAYMENT') { const newStatus = invoice.paymentStatus === 'PAID' ? 'PENDING' : 'PAID'; updates = { paymentStatus: newStatus, updatedAt: nowStr, paidAt: newStatus === 'PAID' ? nowStr : null }; } else if (action === 'CHANGE_METHOD' && newVal) { updates = { paymentMethod: newVal, updatedAt: nowStr }; } await updateDoc(ref, updates); const updatedInvoice = { ...invoice, ...updates }; setB2bInvoices(b2bInvoices.map(i => i.id === invoice.id ? updatedInvoice : i)); if (updatedInvoice.status === 'FACTURE') { syncToSheet({ type: 'B2B_UPDATE', id: updatedInvoice.id, clientName: updatedInvoice.clientName, date: new Date(updatedInvoice.date).toLocaleDateString('fr-FR'), desc: updatedInvoice.desc || (updatedInvoice.items && updatedInvoice.items[0]?.desc), qty: updatedInvoice.qty || 1, price: updatedInvoice.price || updatedInvoice.total, total: updatedInvoice.total, paymentStatus: updatedInvoice.paymentStatus, paymentMethod: updatedInvoice.paymentMethod }); } };

  return (
    <div className="space-y-6 text-left">
      <div className="flex gap-2 p-1 bg-gray-200 rounded-xl w-fit flex-wrap theme-btn"><button onClick={() => setViewMode('PENDING')} className={`px-4 py-2 font-bold text-sm theme-btn ${viewMode === 'PENDING' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>Élèves (À traiter)</button><button onClick={() => setViewMode('ARCHIVED')} className={`px-4 py-2 font-bold text-sm theme-btn ${viewMode === 'ARCHIVED' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>Élèves (Archives)</button><button onClick={() => setViewMode('BOUTIQUE')} className={`px-4 py-2 font-bold text-sm flex gap-1 items-center theme-btn ${viewMode === 'BOUTIQUE' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-500'}`}><ShoppingBag size={14}/> Boutique</button><button onClick={() => setViewMode('B2B')} className={`px-4 py-2 font-bold text-sm flex gap-1 items-center theme-btn ${viewMode === 'B2B' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500'}`}><Briefcase size={14}/> Prestations PRO</button></div>
      {viewMode === 'BOUTIQUE' ? <AdminBoutiqueTab /> : viewMode === 'B2B' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 theme-card"><h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><Users className="text-indigo-500"/> Annuaire Clients Pro</h3><form onSubmit={handleAddProClient} className="flex flex-col gap-2 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-200 theme-card"><input value={newProClient.name || ''} onChange={e=>setNewProClient({...newProClient, name: e.target.value})} placeholder="Nom *" className="p-2 border rounded-lg outline-none text-sm theme-btn"/><input value={newProClient.address || ''} onChange={e=>setNewProClient({...newProClient, address: e.target.value})} placeholder="Adresse complète *" className="p-2 border rounded-lg outline-none text-sm theme-btn"/><input value={newProClient.siret || ''} onChange={e=>setNewProClient({...newProClient, siret: e.target.value})} placeholder="SIRET" className="p-2 border rounded-lg outline-none text-sm theme-btn"/><div className="flex gap-2 mt-2">{editingProId && <button type="button" onClick={()=>{setEditingProId(null); setNewProClient({name:'', address:'', siret:''});}} className="flex-1 py-2 bg-gray-200 text-gray-700 font-bold theme-btn">Annuler</button>}<button type="submit" className="flex-[2] bg-gray-800 text-white font-bold py-2 theme-btn">{editingProId ? 'Mettre à jour' : 'Ajouter'}</button></div></form><div className="space-y-2 max-h-40 overflow-y-auto pr-2">{proClients.map(c => (<div key={c.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100 shadow-sm theme-card"><div><p className="font-bold text-sm text-gray-800">{c.name}</p><p className="text-xs text-gray-500">{c.address}</p></div><div className="flex gap-1"><button onClick={() => { setNewProClient(c); setEditingProId(c.id); }} className="text-amber-500 p-2"><Edit2 size={16}/></button><button onClick={() => handleDeleteProClient(c.id)} className="text-red-500 p-2"><Trash2 size={16}/></button></div></div>))}</div></div>
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-200 ring-4 ring-indigo-50 theme-card"><h3 className="font-bold text-indigo-900 mb-6 flex items-center gap-2 text-lg"><FileSignature className="text-indigo-600"/> {editingB2bId ? 'Modifier la prestation' : 'Nouveau Devis PRO'}</h3>{proClients.length === 0 ? <p className="text-sm text-gray-500">Ajoutez d'abord un client.</p> : (<form onSubmit={handleCreateDevis} className="space-y-4">
              <select value={b2bInvoiceData.clientId} onChange={e=>setB2bInvoiceData({...b2bInvoiceData, clientId: e.target.value})} className="w-full p-3 border border-gray-200 bg-white outline-none focus:border-indigo-500 theme-btn"><option value="">-- Client --</option>{proClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <div className="space-y-3 bg-gray-50 p-3 rounded-xl border border-gray-200 theme-card">
                <div className="flex justify-between items-center"><label className="text-xs font-bold text-gray-500 uppercase">Lignes de prestation</label></div>
                {b2bInvoiceData.items.map((item, idx) => (
                  <div key={idx} className="flex flex-col gap-2 p-3 bg-white rounded-lg border shadow-sm relative theme-card">
                     <textarea value={item.desc} onChange={e => { const newItems = [...b2bInvoiceData.items]; newItems[idx].desc = e.target.value; setB2bInvoiceData({...b2bInvoiceData, items: newItems}); }} placeholder="Description de la prestation" className="w-full p-2 border rounded-lg outline-none text-sm min-h-[60px] theme-btn"/>
                     <div className="flex gap-2 items-center">
                       <input type="number" step="0.5" value={item.qty} onChange={e => { const newItems = [...b2bInvoiceData.items]; newItems[idx].qty = Number(e.target.value); setB2bInvoiceData({...b2bInvoiceData, items: newItems}); }} placeholder="Qté" className="w-20 p-2 border rounded-lg outline-none text-sm text-center theme-btn"/>
                       <span className="text-gray-400 text-sm">x</span>
                       <input type="number" step="1" value={item.price} onChange={e => { const newItems = [...b2bInvoiceData.items]; newItems[idx].price = Number(e.target.value); setB2bInvoiceData({...b2bInvoiceData, items: newItems}); }} placeholder="Prix (€)" className="w-24 p-2 border rounded-lg outline-none text-sm text-right theme-btn"/>
                       <span className="ml-auto font-bold text-indigo-700 text-sm">{(item.qty * item.price).toFixed(2)} €</span>
                       {b2bInvoiceData.items.length > 1 && <button type="button" onClick={() => { const newItems = b2bInvoiceData.items.filter((_, i) => i !== idx); setB2bInvoiceData({...b2bInvoiceData, items: newItems}); }} className="ml-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button>}
                     </div>
                  </div>
                ))}
                <button type="button" onClick={() => setB2bInvoiceData({...b2bInvoiceData, items: [...b2bInvoiceData.items, {desc: '', qty: 1, price: 0}]})} className="w-full py-2 border-2 border-dashed border-indigo-200 text-indigo-600 font-bold rounded-lg text-sm flex justify-center gap-2 hover:bg-indigo-50 transition-colors theme-btn"><Plus size={16}/> Ajouter une ligne</button>
              </div>
              <div className="flex gap-2 mt-4">{editingB2bId && <button type="button" onClick={()=>{setEditingB2bId(null); setB2bInvoiceData({clientId:'', items:[{desc:'', qty:1, price:0}]});}} className="flex-1 bg-gray-200 py-3 rounded-xl font-bold hover:bg-gray-300 theme-btn">Annuler</button>}<button type="submit" className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-md theme-btn">{editingB2bId ? 'Mettre à jour' : 'Créer Devis'}</button></div>
            </form>)}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 theme-card"><h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2 text-lg"><FileText className="text-gray-500"/> Suivi des Prestations</h3><div className="space-y-4">{b2bInvoices.map(inv => { const client = proClients.find(c => c.id === inv.clientId); return (<div key={inv.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col gap-3 theme-card"><div className="flex justify-between items-start"><div><div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 theme-btn">{inv.status}</span><span className="font-bold text-gray-800">{inv.clientName}</span></div><p className="text-sm text-gray-600">{inv.desc || (inv.items && inv.items[0]?.desc)}</p></div><div className="text-right flex flex-col items-end gap-2"><span className="text-lg font-black text-indigo-700">{inv.total} €</span>{client && <button onClick={() => generateB2BInvoicePDF(inv, client)} className="flex items-center gap-1 text-xs font-bold bg-white border border-gray-300 px-2 py-1.5 rounded-lg hover:bg-gray-100 theme-btn"><Download size={12}/> PDF</button>}</div></div>{inv.status === 'DEVIS' ? <div className="flex gap-2"><button onClick={() => handleB2BAction(inv, 'TO_FACTURE')} className="flex-[2] py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold theme-btn">Passer en Facture</button><button onClick={() => { setEditingB2bId(inv.id); setB2bInvoiceData({ clientId: inv.clientId, items: inv.items && inv.items.length > 0 ? inv.items : [{desc: inv.desc || '', qty: inv.qty || 1, price: inv.price || 0}] }); }} className="flex-1 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-bold hover:bg-gray-50 theme-btn">Modifier</button><button onClick={() => handleDeleteB2b(inv.id)} className="px-3 py-2 bg-red-100 text-red-600 hover:bg-red-200 theme-btn"><Trash2 size={16}/></button></div> : (<div className="flex gap-2 items-center border-t border-gray-200 pt-3 mt-1"><select value={inv.paymentMethod} onChange={(e) => handleB2BAction(inv, 'CHANGE_METHOD', e.target.value)} className="flex-[2] text-xs font-bold p-2 border bg-white outline-none theme-btn"><option value="ESPECE">Espèces</option><option value="VIREMENT_RIB">Virement</option><option value="WERO_PAYPAL">Wero/Paypal</option></select><button onClick={() => handleB2BAction(inv, 'TOGGLE_PAYMENT')} className={`flex-[2] flex justify-center gap-1 px-3 py-2 text-xs font-bold theme-btn ${inv.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{inv.paymentStatus === 'PAID' ? <CheckCircle size={14}/> : <Clock size={14}/>} {inv.paymentStatus === 'PAID' ? 'Payé' : 'À régler'}</button><button onClick={() => handleDeleteB2b(inv.id)} className="p-2 text-red-400 hover:text-red-600"><Trash2 size={16}/></button></div>)}</div>); })}</div></div>
        </div>
      ) : (
        <div className="space-y-4">
          {classesToDisplay.length === 0 ? <p className="text-gray-500 text-center py-10">Aucune facture dans cette catégorie.</p> : classesToDisplay.map((c:any) => (
            <div key={c.classId} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden text-left theme-card">
              <div className="p-4 bg-gray-50 border-b border-gray-100"><div><h3 className="font-bold text-gray-800 text-lg">{c.classTitle}</h3><p className="text-sm text-gray-500">{new Date(c.date).toLocaleDateString('fr-FR')} - {c.bookings.length} facture(s) concernée(s)</p></div></div>
              <div className="p-2">
                {c.bookings.map((b: any) => {
                  const isUnpaidPast = b.paymentStatus === 'PENDING' && b.isPast;
                  return (
                    <div key={b.id} className={`flex justify-between items-center p-3 m-2 border rounded-xl theme-card ${isUnpaidPast ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                      <div><p className="font-bold text-gray-800 text-sm flex items-center gap-2">{b.userName.replace(' (Manuel)', '')}{isUnpaidPast && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-black theme-btn">Retard</span>}</p><p className={`text-xs font-medium mt-0.5 ${isUnpaidPast ? 'text-red-600' : 'text-gray-500'}`}>{b.paymentStatus === 'PENDING' ? `En attente de paiement (${b.paymentMethod})` : `Payé (${b.paymentMethod}) - Facture non téléchargée`}</p></div>
                      <div className="flex gap-2">
                        {b.paymentStatus === 'PENDING' && (<button onClick={async () => { await updateDoc(doc(db, "bookings", b.id), { paymentStatus: 'PAID', paidAt: new Date().toISOString() }); syncToSheet({ type: 'BOOKING_UPDATE', classId: b.classId, classTitle: b.classTitle, date: b.dateStr, time: b.timeStr, location: b.location || '', studentId: b.userId, studentName: `${b.userName} (${b.paymentMethod})`, paymentStatus: 'PAID', price: b.price }); }} className="p-2 rounded-lg font-bold text-xs bg-green-50 text-green-600 hover:bg-green-100 flex items-center gap-1 border border-green-200 theme-btn"><CheckCircle size={14}/> Valider Paiement</button>)}
                        <button onClick={async () => { await generateInvoicePDF(b, usersInfo[b.userId] || null, {title: c.classTitle, startAt: new Date(c.date), price: b.price}); await updateDoc(doc(db, "bookings", b.id), { invoiceDownloaded: true }); }} className={`p-2 rounded-lg font-bold text-xs flex items-center gap-1 border theme-btn ${b.paymentStatus === 'PAID' ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}><Download size={14}/> {b.paymentStatus === 'PAID' ? 'Télécharger & Archiver' : 'Brouillon PDF'}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AdminStudentsTab = ({ onImpersonate }: { onImpersonate: (id: string) => void }) => {
  const [users, setUsers] = useState<UserProfile[]>([]); const [searchTerm, setSearchTerm] = useState(''); const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userBookings, setUserBookings] = useState<BookingInfo[]>([]); const [userPurchases, setUserPurchases] = useState<CreditPurchase[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'history' | 'profile'>('history'); const [memoText, setMemoText] = useState(''); const [savingMemo, setSavingMemo] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false); const [editProfileData, setEditProfileData] = useState<Partial<UserProfile>>({});

  useEffect(() => { const unsub = onSnapshot(query(collection(db, "users")), (snap) => setUsers(snap.docs.map(d => ({id: d.id, ...d.data()} as UserProfile)))); return () => unsub(); }, []);
  useEffect(() => {
    if (selectedUserId) {
      const unsubBookings = onSnapshot(query(collection(db, "bookings"), where("userId", "==", selectedUserId)), (snap) => { setUserBookings(snap.docs.map(d => ({id: d.id, ...d.data()} as BookingInfo))); });
      const unsubPurchases = onSnapshot(query(collection(db, "credit_purchases"), where("userId", "==", selectedUserId)), (snap) => { setUserPurchases(snap.docs.map(d => ({id: d.id, ...d.data()} as CreditPurchase))); });
      const selectedUser = users.find(u => u.id === selectedUserId);
      if (selectedUser) { setMemoText(selectedUser.adminMemo || ''); setEditProfileData(selectedUser); setIsEditingProfile(false); }
      return () => { unsubBookings(); unsubPurchases(); };
    }
  }, [selectedUserId, users]);

  const handleManualCredit = async (u: UserProfile, isAdding: boolean) => { try { if (isAdding) { const expires = new Date(); expires.setFullYear(expires.getFullYear() + 1); await updateDoc(doc(db, "users", u.id), { creditPacks: [...(u.creditPacks || []), { id: 'manual_' + Date.now(), qty: 1, remaining: 1, expiresAt: expires.toISOString() }] }); } else { if (u.creditPacks && u.creditPacks.length > 0) { const updatedPacks = [...u.creditPacks]; const packToReduce = updatedPacks.find(p => p.remaining > 0); if (packToReduce) { packToReduce.remaining -= 1; await updateDoc(doc(db, "users", u.id), { creditPacks: updatedPacks }); } } } } catch (e) { alert("Erreur."); } };
  const handleSaveMemo = async (u: UserProfile) => { setSavingMemo(true); try { await updateDoc(doc(db, "users", u.id), { adminMemo: memoText }); await syncToSheet({ type: 'PROFILE', id: u.id, displayName: u.displayName, email: u.email, adminMemo: memoText }); alert("Mémo enregistré !"); } catch (e) {} setSavingMemo(false); };
  const handleSaveAdminProfileEdit = async (u: UserProfile) => { try { await updateDoc(doc(db, "users", u.id), editProfileData); await syncToSheet({ type: 'PROFILE', id: u.id, ...editProfileData }); setIsEditingProfile(false); alert("Profil mis à jour !"); } catch (e) {} };

  const filteredUsers = users.filter(u => u.role !== 'admin' && u.role !== 'dev-admin' && (u.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || u.email.toLowerCase().includes(searchTerm.toLowerCase())));
  const selectedUser = users.find(u => u.id === selectedUserId);
  const timeline = [ ...userBookings.map(b => ({ type: 'BOOKING', dateObj: new Date(b.date), data: b })), ...userPurchases.map(p => ({ type: 'PACK', dateObj: new Date(p.date), data: p })) ].sort((a,b) => b.dateObj.getTime() - a.dateObj.getTime());

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start text-left">
      <div className="bg-white border-2 border-gray-800 rounded-2xl p-4 w-full lg:w-1/3 flex flex-col h-[75vh] theme-card">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Users size={18}/> Annuaire Élèves</h3>
        <div className="relative mb-4"><Search size={18} className="absolute left-3 top-3 text-gray-400"/><input type="text" placeholder="Rechercher un nom ou mail..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-amber-500 theme-btn text-sm" /></div>
        <div className="space-y-2 overflow-y-auto flex-1 pr-2">
          {filteredUsers.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">Aucun élève trouvé.</p> : filteredUsers.map(u => (
            <div key={u.id} className={`flex flex-col p-3 border rounded-xl cursor-pointer transition-colors theme-card ${selectedUserId === u.id ? 'border-gray-800 bg-gray-50 shadow-sm' : 'border-gray-100 hover:border-gray-300'}`} onClick={() => {setSelectedUserId(u.id); setActiveSubTab('history');}}>
              <div className="flex justify-between items-center mb-1">
                 <span className="font-bold text-sm text-gray-800 flex items-center gap-2">{u.displayName} {!u.hasFilledForm && <span title="Profil incomplet"><AlertTriangle size={14} className="text-red-500" /></span>}</span>
                 <button onClick={(e) => { e.stopPropagation(); onImpersonate(u.id); }} className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold hover:bg-indigo-200" title="Voir en tant que cet élève">👻</button>
              </div>
              <span className="text-xs text-gray-500 mb-2 truncate">{u.email}</span>
              <div className="flex gap-2 items-center"><button onClick={(e) => { e.stopPropagation(); handleManualCredit(u, false)}} className="w-6 h-6 bg-gray-200 text-xs font-bold hover:bg-gray-300 theme-btn">-</button><span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 shadow-sm theme-btn">{getActiveCredits(u)} cr</span><button onClick={(e) => { e.stopPropagation(); handleManualCredit(u, true)}} className="w-6 h-6 bg-amber-200 text-amber-800 text-xs font-bold hover:bg-amber-300 theme-btn">+</button></div>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-6 w-full lg:w-2/3 h-[75vh] flex flex-col theme-card">
        {!selectedUser ? (
          <div className="h-full flex items-center justify-center text-gray-400 flex-col gap-3"><User size={48} className="opacity-20"/><p>Sélectionnez un élève dans la liste.</p></div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100">
              <div><h3 className="font-black text-2xl text-gray-900">{selectedUser.displayName}</h3><p className="text-sm text-gray-500 flex items-center gap-2 mt-1"><Phone size={14}/> {selectedUser.phone || 'Non renseigné'}</p></div>
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl theme-btn"><button onClick={() => setActiveSubTab('history')} className={`px-4 py-2 text-sm font-bold theme-btn ${activeSubTab === 'history' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Historique & Achats</button><button onClick={() => setActiveSubTab('profile')} className={`px-4 py-2 text-sm font-bold theme-btn ${activeSubTab === 'profile' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Profil & Mémo</button></div>
            </div>
            <div className="flex-1 overflow-y-auto pr-2">
              {activeSubTab === 'history' && (
                timeline.length === 0 ? <p className="text-gray-500 text-center py-10">Aucun historique pour cet élève.</p> : (
                  <div className="space-y-4">
                    {timeline.map((item, idx) => {
                      if (item.type === 'BOOKING') {
                        const b = item.data as BookingInfo;
                        return (
                          <div key={`b-${b.id}-${idx}`} className="flex justify-between items-center p-4 rounded-xl border border-gray-100 bg-white shadow-sm theme-card">
                            <div><div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-black px-2 py-0.5 bg-blue-100 text-blue-700 theme-btn">COURS</span><h4 className="font-bold text-gray-800 text-sm">{b.classTitle}</h4></div><p className="text-xs text-gray-500">{new Date(b.date).toLocaleDateString('fr-FR')} à {new Date(b.date).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</p></div>
                            <div className="flex flex-col items-end gap-2"><div className="flex items-center gap-2"><span className="text-xs font-bold text-gray-500">{b.paymentMethod}</span><span className={`text-[10px] font-bold px-2 py-1 rounded uppercase theme-btn ${b.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{b.paymentStatus === 'PAID' ? 'Payé' : 'À régler'}</span></div>{b.paymentStatus === 'PAID' && b.paymentMethod !== 'CREDIT' && <button onClick={() => generateInvoicePDF(b, selectedUser, { title: b.classTitle, startAt: new Date(b.date), price: b.price })} className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100 transition-colors theme-btn"><Download size={12}/> Facture PDF</button>}</div>
                          </div>
                        );
                      } else {
                        const p = item.data as CreditPurchase;
                        return (
                          <div key={`p-${p.id}-${idx}`} className="flex justify-between items-center p-4 rounded-xl border border-amber-200 bg-amber-50 shadow-sm theme-card">
                            <div><div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-black px-2 py-0.5 bg-amber-200 text-amber-800 theme-btn">BOUTIQUE</span><h4 className="font-bold text-gray-800 text-sm">{p.packName}</h4></div><p className="text-xs text-gray-500">Acheté le {new Date(p.date).toLocaleDateString('fr-FR')}</p></div>
                            <div className="flex flex-col items-end gap-2"><div className="flex items-center gap-2"><span className="text-sm font-black text-amber-600">{p.price} €</span><span className={`text-[10px] font-bold px-2 py-1 rounded uppercase theme-btn ${p.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{p.status === 'PAID' ? 'Payé' : 'À régler'}</span></div>{p.status === 'PAID' && <button onClick={() => generatePackInvoicePDF(p, selectedUser)} className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100 transition-colors theme-btn"><Download size={12}/> Facture PDF</button>}</div>
                          </div>
                        );
                      }
                    })}
                  </div>
                )
              )}
              {activeSubTab === 'profile' && (
                <div className="space-y-6">
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 relative theme-card">
                    {!isEditingProfile ? (
                      <>
                        <button onClick={() => setIsEditingProfile(true)} className="absolute top-4 right-4 text-amber-600 hover:text-amber-700 bg-amber-50 p-2 rounded-lg font-bold text-xs flex items-center gap-1 theme-btn"><Edit2 size={14}/> Éditer</button>
                        <div className="grid grid-cols-2 gap-4">
                          <div><p className="text-xs text-gray-400 font-bold uppercase mb-1">Email</p><p className="text-sm text-gray-800 font-medium">{selectedUser.email}</p></div>
                          <div><p className="text-xs text-gray-400 font-bold uppercase mb-1">Téléphone</p><p className="text-sm text-gray-800 font-medium">{selectedUser.phone || '-'}</p></div>
                          <div><p className="text-xs text-gray-400 font-bold uppercase mb-1">Date de naissance</p><p className="text-sm text-gray-800 font-medium">{selectedUser.birthDate ? new Date(selectedUser.birthDate).toLocaleDateString('fr-FR') : '-'}</p></div>
                          <div><p className="text-xs text-gray-400 font-bold uppercase mb-1">Droit à l'image</p><p className={`text-sm font-bold ${selectedUser.imageRights === 'yes' ? 'text-green-600' : 'text-red-500'}`}>{selectedUser.imageRights === 'yes' ? 'OUI' : selectedUser.imageRights === 'no' ? 'NON' : '-'}</p></div>
                          <div className="col-span-2"><p className="text-xs text-gray-400 font-bold uppercase mb-1">Adresse</p><p className="text-sm text-gray-800 font-medium">{selectedUser.street ? `${selectedUser.street}, ${selectedUser.zipCode} ${selectedUser.city}` : '-'}</p></div>
                          <div className="col-span-2 border-t pt-3 mt-1"><p className="text-xs text-red-400 font-bold uppercase mb-1 flex items-center gap-1"><HeartPulse size={12}/> Contact Urgence</p><p className="text-sm text-gray-800 font-medium">{selectedUser.emergencyContact || '-'} ({selectedUser.emergencyPhone || '-'})</p></div>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className="text-xs font-bold text-gray-500">Nom complet</label><input value={editProfileData.displayName || ''} onChange={e=>setEditProfileData({...editProfileData, displayName: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div><label className="text-xs font-bold text-gray-500">Email</label><input value={editProfileData.email || ''} onChange={e=>setEditProfileData({...editProfileData, email: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div><label className="text-xs font-bold text-gray-500">Téléphone</label><input value={editProfileData.phone || ''} onChange={e=>setEditProfileData({...editProfileData, phone: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div><label className="text-xs font-bold text-gray-500">Date Naissance</label><input type="date" value={editProfileData.birthDate || ''} onChange={e=>setEditProfileData({...editProfileData, birthDate: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div className="col-span-2"><label className="text-xs font-bold text-gray-500">Rue</label><input value={editProfileData.street || ''} onChange={e=>setEditProfileData({...editProfileData, street: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div><label className="text-xs font-bold text-gray-500">Code Postal</label><input value={editProfileData.zipCode || ''} onChange={e=>setEditProfileData({...editProfileData, zipCode: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div><label className="text-xs font-bold text-gray-500">Ville</label><input value={editProfileData.city || ''} onChange={e=>setEditProfileData({...editProfileData, city: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div><label className="text-xs font-bold text-red-500">Contact Urgence</label><input value={editProfileData.emergencyContact || ''} onChange={e=>setEditProfileData({...editProfileData, emergencyContact: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div><label className="text-xs font-bold text-red-500">Tél Urgence</label><input value={editProfileData.emergencyPhone || ''} onChange={e=>setEditProfileData({...editProfileData, emergencyPhone: e.target.value})} className="w-full p-2 border rounded-lg text-sm theme-btn"/></div>
                          <div className="col-span-2"><label className="text-xs font-bold text-gray-500">Droit à l'image</label><select value={editProfileData.imageRights || ''} onChange={e=>setEditProfileData({...editProfileData, imageRights: e.target.value as any})} className="w-full p-2 border rounded-lg text-sm bg-white theme-btn"><option value="">Non renseigné</option><option value="yes">Oui</option><option value="no">Non</option></select></div>
                        </div>
                        <div className="flex gap-2 pt-2"><button onClick={() => setIsEditingProfile(false)} className="flex-1 py-2 bg-gray-200 text-gray-700 font-bold rounded-lg text-sm theme-btn">Annuler</button><button onClick={() => handleSaveAdminProfileEdit(selectedUser)} className="flex-1 py-2 bg-amber-500 text-white font-bold rounded-lg text-sm shadow-md theme-btn">Enregistrer</button></div>
                      </div>
                    )}
                  </div>
                  <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 theme-card">
                    <h4 className="font-bold text-blue-900 mb-3 flex items-center gap-2"><Info size={18}/> Mémo Administration (Privé)</h4>
                    <textarea value={memoText} onChange={e => setMemoText(e.target.value)} placeholder="Ex: Blessure épaule..." className="w-full p-3 rounded-xl border outline-none text-sm min-h-[120px] bg-white border-blue-200 theme-btn"/>
                    <button onClick={() => handleSaveMemo(selectedUser)} disabled={savingMemo} className="mt-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg text-sm shadow-sm theme-btn">{savingMemo ? 'Enregistrement...' : 'Enregistrer le Mémo'}</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const ClassCard = ({ info, onDelete, onEditClick, onBookClick, onCancelClick, processingId, userProfile, isBooked, onRefresh }: any) => {
  const [showAttendees, setShowAttendees] = useState(false);
  const isFull = info.attendeesCount >= info.maxCapacity;
  const isProcessing = processingId === info.id; const canBook = userProfile?.hasFilledForm;

  const cardStyle = info.color ? { borderColor: info.color, boxShadow: isBooked ? `0 0 0 4px ${info.color}30` : 'none' } : {};
  const timeStyle = info.color ? { color: info.color, backgroundColor: `${info.color}15` } : {};
  const btnStyle = info.color ? { backgroundColor: info.color, color: '#fff' } : {};

  return (
    <div style={cardStyle} className={`bg-white p-5 shadow-sm border-2 relative flex flex-col justify-between text-left theme-card ${!info.color && isBooked ? 'border-amber-400 ring-4 ring-amber-50' : !info.color ? 'border-gray-100' : ''}`}>
      {(userProfile?.role === 'admin' || userProfile?.role === 'dev-admin') && (<div className="absolute top-3 right-3 flex gap-2"><a href={generateGoogleCalendarLink(info.title, info.startAt, info.endAt, info.locationAddress || info.location, info.description || '')} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-blue-500"><CalendarPlus size={18}/></a><button onClick={() => onEditClick(info)} className="text-gray-300 hover:text-amber-500"><Edit2 size={18}/></button><button onClick={() => { if(window.confirm("Supprimer ?")) onDelete(info.id); }} className="text-gray-300 hover:text-red-500"><Trash2 size={18}/></button></div>)}
      <div>
        <div className="flex justify-between items-start mb-4 pr-16 gap-2"><div><h3 className="font-bold text-xl text-gray-800 leading-tight mb-1">{info.title}</h3><p className="text-sm text-gray-500 capitalize">{info.startAt.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'})}</p></div></div>
        <div className="flex flex-col items-start mb-3"><div style={timeStyle} className={`text-xl font-black px-3 py-1.5 theme-btn ${!info.color ? 'text-amber-600 bg-amber-50' : ''}`}>{info.startAt.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}</div>{info.price && <span className="text-sm font-bold text-gray-500 mt-1 bg-gray-100 px-2 py-0.5 theme-btn">Tarif : {info.price}</span>}</div>
        <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 mb-3 inline-block theme-btn">Prof : {info.instructor}</span>
        {info.description && <p className="text-sm text-gray-600 mb-4 bg-gray-50 p-3 border theme-card">{info.description}</p>}
        <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-6 font-medium"><span className={`flex gap-1.5 items-center ${isFull && !isBooked ? 'text-red-500' : ''}`}><User size={16}/> {info.attendeesCount}/{info.maxCapacity}</span><a href={`https://google.com/maps/search/?api=1&query=${encodeURIComponent(info.locationAddress || info.location)}`} target="_blank" rel="noreferrer" className={`flex gap-1.5 items-center underline ${info.color ? '' : 'hover:text-amber-600'}`} style={info.color ? {color: info.color} : {}}><MapPin size={16}/> {info.location}</a></div>
      </div>
      {info.externalLink ? (<a href={info.externalLink} target="_blank" rel="noreferrer" style={btnStyle} className={`w-full py-3.5 font-bold text-white text-center block shadow-lg transition-colors theme-btn ${!info.color ? 'bg-green-500 hover:bg-green-600 shadow-green-200' : ''}`}>Réserver sur le site partenaire</a>) : isBooked ? (<button onClick={() => onCancelClick(info.id)} disabled={isProcessing} className="w-full py-3.5 font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 theme-btn">Annuler ma réservation</button>) : (<button onClick={() => onBookClick(info.id)} disabled={!canBook || isFull || info.endAt < new Date()} style={(!canBook || isFull || info.endAt < new Date()) ? {} : btnStyle} className={`w-full py-3.5 font-bold text-white theme-btn ${!canBook || isFull || info.endAt < new Date() ? 'bg-gray-300' : !info.color ? 'bg-gradient-to-r from-amber-500 to-amber-600 shadow-md hover:opacity-90 transition-opacity' : 'shadow-md hover:opacity-90 transition-opacity'}`}>{info.endAt < new Date() ? 'Terminé' : !canBook ? 'Fiche requise' : isFull ? 'Cours Complet' : 'Réserver ma place'}</button>)}
      {(userProfile?.role === 'admin' || userProfile?.role === 'dev-admin') && !info.externalLink && <div className="mt-4"><button onClick={() => setShowAttendees(!showAttendees)} className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-amber-700 bg-amber-50 theme-btn"><Users size={16}/> Inscrits {showAttendees ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button>{showAttendees && <AdminClassAttendees classInfo={info} onRefresh={onRefresh} />}</div>}
    </div>
  );
};

const AdminClassForm = ({ onAdd, locations, templates, editClassData, onCancelEdit }: { onAdd: () => void, locations: StudioLocation[], templates: ClassTemplate[], editClassData: DanceClass | null, onCancelEdit: () => void }) => {
  const [isOpen, setIsOpen] = useState(false); const [data, setData] = useState({title: '', date: '', desc: '', cap: 12, loc: '', price: '', externalLink: '', color: ''});
  useEffect(() => { if (editClassData) { setData({ title: editClassData.title, date: formatForInput(editClassData.startAt), desc: editClassData.description || '', cap: editClassData.maxCapacity, loc: editClassData.location, price: editClassData.price || '', externalLink: editClassData.externalLink || '', color: editClassData.color || '' }); setIsOpen(true); } else { if(!data.loc && locations.length > 0) setData(prev => ({...prev, loc: locations[0].name})); } }, [editClassData, locations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!data.date || !data.title) return;
    const locObj = locations.find(l => l.name === data.loc); const payload = { title: data.title, description: data.desc, instructor: "Ali", location: data.loc, locationAddress: locObj ? locObj.address : '', price: data.price, startAt: Timestamp.fromDate(new Date(data.date)), endAt: Timestamp.fromDate(new Date(new Date(data.date).getTime() + 90*60000)), maxCapacity: Number(data.cap), externalLink: data.externalLink, color: data.color };
    if (editClassData) await updateDoc(doc(db, "classes", editClassData.id), payload); else await addDoc(collection(db, "classes"), { ...payload, attendeesCount: 0, attendeeIds: [] });
    setIsOpen(false); onCancelEdit(); onAdd();
  };
  if (!isOpen && !editClassData) return <button onClick={() => setIsOpen(true)} className="w-full mb-8 border-2 border-dashed border-amber-300 text-amber-700 py-4 flex justify-center items-center gap-2 font-bold hover:bg-amber-50 theme-card"><Plus/> Créer un nouveau cours</button>;
  return (
    <div className="bg-white p-6 mb-8 border border-amber-100 shadow-sm relative text-left theme-card">
      <h3 className="font-bold text-amber-800 mb-4 text-lg">{editClassData ? 'Modifier le cours' : 'Nouveau Cours'}</h3>
      {!editClassData && templates.length > 0 && <select className="w-full mb-4 p-3 bg-amber-50 border border-amber-200 font-bold outline-none theme-btn" onChange={(e) => { const t = templates.find(x => x.id === e.target.value); if (t) setData({...data, title: t.title, loc: t.locationName, cap: t.maxCapacity, desc: t.description, price: t.price, externalLink: t.externalLink || '', color: t.color || '' }); }}><option value="">-- Charger un modèle --</option>{templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <input value={data.title} onChange={e=>setData({...data, title: e.target.value})} className="w-full p-3 border theme-btn" placeholder="Titre du cours *"/>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3"><input type="datetime-local" value={data.date} onChange={e=>setData({...data, date: e.target.value})} className="w-full p-3 border theme-btn"/><select value={data.loc} onChange={e=>setData({...data, loc: e.target.value})} className="w-full p-3 border bg-white theme-btn">{locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}</select><input type="text" value={data.price} onChange={e=>setData({...data, price: e.target.value})} className="w-full p-3 border theme-btn" placeholder="Tarif"/><input type="number" value={data.cap} onChange={e=>setData({...data, cap: Number(e.target.value)})} className="w-full p-3 border theme-btn" placeholder="Places"/></div>
        <textarea value={data.desc} onChange={e=>setData({...data, desc: e.target.value})} className="w-full p-3 border min-h-[100px] theme-btn" placeholder="Description"/>
        <input value={data.externalLink} onChange={e=>setData({...data, externalLink: e.target.value})} className="w-full p-3 border border-green-200 bg-green-50 outline-none theme-btn" placeholder="Lien de réservation externe (Optionnel)"/>
        <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 theme-card">
          <input type="color" value={data.color || '#f59e0b'} onChange={e=>setData({...data, color: e.target.value})} className="w-10 h-10 p-0 border-0 cursor-pointer bg-transparent"/>
          <span className="text-sm font-bold text-gray-700">Couleur de la carte personnalisée</span>
          {data.color && <button type="button" onClick={()=>setData({...data, color: ''})} className="text-xs text-red-500 font-bold ml-auto hover:underline">Retirer la couleur</button>}
        </div>
        <div className="flex gap-3"><button type="button" onClick={()=>{setIsOpen(false); onCancelEdit();}} className="flex-1 py-3 bg-gray-100 font-bold theme-btn">Annuler</button><button type="submit" className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-bold theme-btn">Valider</button></div>
      </form>
    </div>
  );
};

const AdminSettingsTab = ({ locations, templates, globalSettings, creditPacks }: any) => {
  const [editingLocId, setEditingLocId] = useState<string | null>(null); const [editingTplId, setEditingTplId] = useState<string | null>(null); const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [newLocName, setNewLocName] = useState(''); const [newLocAddress, setNewLocAddress] = useState(''); const [newTpl, setNewTpl] = useState({ title: '', loc: locations[0]?.name || '', price: '', cap: 12, desc: '', externalLink: '', color: '' });
  const [remDays, setRemDays] = useState(globalSettings.reminderDays); const [welcomeText, setWelcomeText] = useState(globalSettings.welcomeText || ''); const [welcomeImage, setWelcomeImage] = useState(globalSettings.welcomeImageUrl || '');
  const [welcomeTextSize, setWelcomeTextSize] = useState(globalSettings.welcomeTextSize || 18); const [welcomeImageSize, setWelcomeImageSize] = useState(globalSettings.welcomeImageSize || 50);
  const [newPack, setNewPack] = useState({ name: '', price: 0, qty: 1, validityDays: 90 });

  const addLocation = async () => { if (!newLocName) return; let updatedList; if (editingLocId) { updatedList = locations.map((l:any) => l.id === editingLocId ? { ...l, name: newLocName, address: newLocAddress } : l); setEditingLocId(null); } else { updatedList = [...locations, { id: Date.now().toString(), name: newLocName, address: newLocAddress }]; } await setDoc(doc(db, "settings", "general"), { locations: updatedList }, { merge: true }); setNewLocName(''); setNewLocAddress(''); };
  const removeLocation = async (id: string) => { if(!confirm("Supprimer ?")) return; await setDoc(doc(db, "settings", "general"), { locations: locations.filter((l:any) => l.id !== id) }, { merge: true }); };
  const addTemplate = async (e: React.FormEvent) => { e.preventDefault(); if (!newTpl.title) return; let updatedList; if (editingTplId) { updatedList = templates.map((t:any) => t.id === editingTplId ? { ...t, title: newTpl.title, locationName: newTpl.loc, price: newTpl.price, maxCapacity: Number(newTpl.cap), description: newTpl.desc, externalLink: newTpl.externalLink, color: newTpl.color } : t); setEditingTplId(null); } else { updatedList = [...templates, { id: Date.now().toString(), title: newTpl.title, locationName: newTpl.loc, price: newTpl.price, maxCapacity: Number(newTpl.cap), description: newTpl.desc, externalLink: newTpl.externalLink, color: newTpl.color }]; } await setDoc(doc(db, "settings", "general"), { templates: updatedList }, { merge: true }); setNewTpl({ title: '', loc: locations[0]?.name || '', price: '', cap: 12, desc: '', externalLink: '', color: '' }); };
  const removeTemplate = async (id: string) => { if(!confirm("Supprimer ?")) return; await setDoc(doc(db, "settings", "general"), { templates: templates.filter((t:any) => t.id !== id) }, { merge: true }); };
  const addPack = async (e: React.FormEvent) => { e.preventDefault(); if(!newPack.name) return; let updatedList; if (editingPackId) { updatedList = creditPacks.map((p:any) => p.id === editingPackId ? { ...p, ...newPack } : p); setEditingPackId(null); } else { updatedList = [...creditPacks, { id: Date.now().toString(), ...newPack }]; } await setDoc(doc(db, "settings", "general"), { creditPacks: updatedList }, { merge: true }); setNewPack({ name: '', price: 0, qty: 1, validityDays: 90 }); };
  const removePack = async (id: string) => { if(!confirm("Supprimer ce pack ?")) return; await setDoc(doc(db, "settings", "general"), { creditPacks: creditPacks.filter((p:any) => p.id !== id) }, { merge: true }); };
  const saveSettings = async () => { await setDoc(doc(db, "settings", "general"), { reminderDays: remDays, welcomeText, welcomeImageUrl: welcomeImage, welcomeTextSize, welcomeImageSize }, { merge: true }); alert("Enregistré !"); };
  const exportFullBackup = async () => { try { let csv = "COLLECTION;ID;DONNEES\n"; const uSnap = await getDocs(collection(db, "users")); uSnap.forEach(d => { csv += `UTILISATEURS;${d.id};"${JSON.stringify(d.data()).replace(/"/g, '""')}"\n`; }); const cSnap = await getDocs(collection(db, "classes")); cSnap.forEach(d => { csv += `COURS;${d.id};"${JSON.stringify(d.data()).replace(/"/g, '""')}"\n`; }); const bSnap = await getDocs(collection(db, "bookings")); bSnap.forEach(d => { csv += `RESERVATIONS;${d.id};"${JSON.stringify(d.data()).replace(/"/g, '""')}"\n`; }); const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob)); link.setAttribute("download", `Backup_Manuel_Site_${new Date().toLocaleDateString('fr-FR')}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); } catch(e) { alert("Erreur."); } };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
      <div className="bg-white p-6 shadow-sm border border-gray-200 lg:col-span-2 theme-card">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Settings className="text-gray-500"/> Paramètres Généraux</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-50 p-4 border border-gray-200 flex flex-col justify-between gap-4 theme-card"><div><p className="font-bold text-gray-800">Délai relances paiement</p><p className="text-sm text-gray-500">Jours après le cours avant apparition dans les retards.</p></div><div className="flex gap-2"><input type="number" value={remDays} onChange={e => setRemDays(Number(e.target.value))} className="p-2 border w-20 text-center font-bold outline-none theme-btn"/><button onClick={saveSettings} className="bg-gray-800 text-white font-bold py-2 px-4 flex-1 theme-btn">Enregistrer délai</button></div></div>
          <div className="bg-indigo-50 p-4 border border-indigo-200 flex flex-col justify-between gap-4 theme-card"><div><p className="font-bold text-indigo-900 flex items-center gap-2"><Database size={16}/> Sauvegarde des données (Backup)</p><p className="text-sm text-indigo-700">Téléchargez une copie d'urgence (CSV) de toutes vos données Firebase.</p></div><button onClick={exportFullBackup} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 flex items-center justify-center gap-2 transition-colors theme-btn"><Download size={16}/> Sauvegarde Manuelle</button></div>
          <div className="bg-blue-50 p-5 border border-blue-200 md:col-span-2 theme-card">
            <div className="flex justify-between items-center mb-4"><h4 className="font-bold text-blue-900 flex items-center gap-2"><Home size={18}/> Personnalisation de l'Accueil</h4><button onClick={saveSettings} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 shadow-md transition-colors theme-btn">Mettre à jour l'accueil</button></div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div><label className="text-sm font-bold text-blue-800">Texte de bienvenue</label><textarea value={welcomeText} onChange={e => setWelcomeText(e.target.value)} className="w-full p-3 border border-blue-100 mt-1 min-h-[120px] outline-none focus:border-blue-500 theme-btn" placeholder="Ex: Bienvenue sur notre espace..."></textarea></div>
                <div><label className="text-sm font-bold text-blue-800">Lien de l'image (URL Postimages)</label><input type="text" value={welcomeImage} onChange={e => setWelcomeImage(e.target.value)} className="w-full p-3 border border-blue-100 mt-1 outline-none focus:border-blue-500 theme-btn" placeholder="Ex: https://i.postimg.cc/image.jpg" /></div>
                <div className="bg-white p-4 border border-blue-100 space-y-4 shadow-sm theme-card">
                  <div><label className="text-sm font-bold text-gray-700 flex justify-between">Taille du texte <span>{welcomeTextSize}px</span></label><input type="range" min="12" max="36" value={welcomeTextSize} onChange={e => setWelcomeTextSize(Number(e.target.value))} className="w-full mt-2 accent-blue-600" /></div>
                  <div><label className="text-sm font-bold text-gray-700 flex justify-between">Proportion de l'image <span>{welcomeImageSize}%</span></label><input type="range" min="20" max="80" value={welcomeImageSize} onChange={e => setWelcomeImageSize(Number(e.target.value))} className="w-full mt-2 accent-blue-600" disabled={!welcomeImage} /></div>
                </div>
              </div>
              <div>
                <label className="text-sm font-bold text-blue-800 mb-2 block">Aperçu en direct :</label>
                <div className="bg-white shadow-md border border-gray-200 overflow-hidden flex flex-col md:flex-row pointer-events-none origin-top h-full theme-card">
                  {welcomeImage && (<div style={{ width: `${welcomeImageSize}%` }} className="bg-gray-100 border-b md:border-b-0 md:border-r border-gray-100"><img src={welcomeImage} alt="Preview" className="w-full h-full object-cover min-h-[150px]" /></div>)}
                  <div style={{ width: welcomeImage ? `${100 - welcomeImageSize}%` : '100%' }} className="p-6 flex flex-col justify-center"><h2 className="text-xl font-black text-gray-900 mb-4">Bienvenue chez Vertic'Ali !</h2><div className="text-gray-600 whitespace-pre-wrap leading-relaxed" style={{ fontSize: `${welcomeTextSize}px` }}>{welcomeText || "Le texte apparaîtra ici..."}</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-white p-6 shadow-sm border border-amber-200 lg:col-span-2 ring-4 ring-amber-50 theme-card"><h3 className="font-bold text-amber-900 mb-4 flex items-center gap-2"><ShoppingBag className="text-amber-500"/> Offres de la Boutique (Crédits)</h3><form onSubmit={addPack} className="flex flex-col md:flex-row gap-2 mb-4"><input value={newPack.name} onChange={e=>setNewPack({...newPack, name: e.target.value})} placeholder="Nom (Ex: Carte 10 cours)" className="flex-[2] p-2 border outline-none focus:border-amber-500 theme-btn"/><input type="number" value={newPack.qty} onChange={e=>setNewPack({...newPack, qty: Number(e.target.value)})} placeholder="Crédits" className="flex-1 p-2 border outline-none focus:border-amber-500 theme-btn"/><input type="number" value={newPack.price} onChange={e=>setNewPack({...newPack, price: Number(e.target.value)})} placeholder="Prix (€)" className="flex-1 p-2 border outline-none focus:border-amber-500 theme-btn"/><input type="number" value={newPack.validityDays} onChange={e=>setNewPack({...newPack, validityDays: Number(e.target.value)})} placeholder="Validité (jours)" className="flex-1 p-2 border outline-none focus:border-amber-500 theme-btn"/>{editingPackId && <button type="button" onClick={()=>{setEditingPackId(null); setNewPack({name:'',price:0,qty:1,validityDays:90});}} className="bg-gray-200 text-gray-700 font-bold px-4 py-2 theme-btn">Annuler</button>}<button type="submit" className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-2 transition-colors theme-btn">{editingPackId ? 'MAJ' : 'Ajouter'}</button></form><div className="grid grid-cols-1 md:grid-cols-2 gap-2">{creditPacks.map((p:any) => (<div key={p.id} className="flex justify-between items-center bg-amber-50 p-3 border border-amber-100 theme-card"><div><p className="font-bold text-amber-900">{p.name}</p><p className="text-xs text-amber-700">{p.qty} crédits • {p.price}€ • Valable {p.validityDays}j</p></div><div className="flex gap-1"><button onClick={() => {setEditingPackId(p.id); setNewPack({name: p.name, price: p.price, qty: p.qty, validityDays: p.validityDays});}} className="text-amber-500 p-2"><Edit2 size={16}/></button><button onClick={() => removePack(p.id)} className="text-red-500 p-2"><Trash2 size={16}/></button></div></div>))}</div></div>
      <div className="bg-white p-6 shadow-sm border border-gray-200 theme-card"><h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><MapIcon className="text-indigo-500"/> Gestion des Lieux</h3><div className="flex flex-col gap-2 mb-4 bg-gray-50 p-4 border border-gray-200 theme-card"><input value={newLocName} onChange={e=>setNewLocName(e.target.value)} placeholder="Nom du lieu" className="p-2 border outline-none theme-btn"/><input value={newLocAddress} onChange={e=>setNewLocAddress(e.target.value)} placeholder="Adresse complète" className="p-2 border outline-none theme-btn"/><div className="flex gap-2">{editingLocId && <button onClick={()=>{setEditingLocId(null); setNewLocName(''); setNewLocAddress('');}} className="flex-1 bg-gray-200 text-gray-700 font-bold py-2 theme-btn">Annuler</button>}<button onClick={addLocation} className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 transition-colors theme-btn">{editingLocId ? 'MAJ' : 'Ajouter'}</button></div></div><div className="space-y-2">{locations.map((l:any) => (<div key={l.id} className="flex justify-between items-center bg-white p-3 border shadow-sm theme-card"><div><p className="font-bold text-sm">{l.name}</p></div><div className="flex gap-1"><button onClick={() => {setEditingLocId(l.id); setNewLocName(l.name); setNewLocAddress(l.address);}} className="text-amber-500 p-2"><Edit2 size={16}/></button><button onClick={() => removeLocation(l.id)} className="text-red-500 p-2"><Trash2 size={16}/></button></div></div>))}</div></div>
      <div className="bg-white p-6 shadow-sm border border-gray-200 theme-card">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Plus className="text-amber-500"/> Modèles de cours</h3>
        <form onSubmit={addTemplate} className="flex flex-col gap-2 mb-4 bg-gray-50 p-4 border border-gray-200 theme-card">
          <input value={newTpl.title} onChange={e=>setNewTpl({...newTpl, title: e.target.value})} placeholder="Titre" className="p-2 border outline-none focus:border-amber-500 theme-btn"/>
          <select value={newTpl.loc} onChange={e=>setNewTpl({...newTpl, loc: e.target.value})} className="p-2 border bg-white outline-none focus:border-amber-500 theme-btn">{locations.map((l:any) => <option key={l.id} value={l.name}>{l.name}</option>)}</select>
          <div className="flex gap-2"><input value={newTpl.price} onChange={e=>setNewTpl({...newTpl, price: e.target.value})} placeholder="Tarif" className="w-1/2 p-2 border outline-none focus:border-amber-500 theme-btn"/><input type="number" value={newTpl.cap} onChange={e=>setNewTpl({...newTpl, cap: Number(e.target.value)})} placeholder="Capacité max" className="w-1/2 p-2 border outline-none focus:border-amber-500 theme-btn"/></div>
          <textarea value={newTpl.desc} onChange={e=>setNewTpl({...newTpl, desc: e.target.value})} placeholder="Description du cours (Optionnel)" className="p-2 border outline-none focus:border-amber-500 min-h-[80px] theme-btn"/>
          <input value={newTpl.externalLink} onChange={e=>setNewTpl({...newTpl, externalLink: e.target.value})} placeholder="Lien externe (Optionnel)" className="p-2 border border-green-300 bg-green-50 outline-none focus:border-green-500 theme-btn"/>
          <div className="flex items-center gap-3 mt-1 p-2">
            <input type="color" value={newTpl.color || '#f59e0b'} onChange={e=>setNewTpl({...newTpl, color: e.target.value})} className="w-8 h-8 p-0 border-0 rounded cursor-pointer bg-transparent"/>
            <span className="text-sm font-bold text-gray-700">Couleur du modèle</span>
            {newTpl.color && <button type="button" onClick={()=>setNewTpl({...newTpl, color: ''})} className="text-xs text-red-500 font-bold ml-auto hover:underline">Retirer la couleur</button>}
          </div>
          <div className="flex gap-2 mt-2">{editingTplId && <button type="button" onClick={()=>{setEditingTplId(null); setNewTpl({title:'', loc:'', price:'', cap:12, desc:'', externalLink:'', color:''});}} className="flex-1 bg-gray-200 text-gray-700 font-bold py-2 theme-btn">Annuler</button>}<button type="submit" className="flex-[2] bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 transition-colors theme-btn">{editingTplId ? 'Mettre à jour' : 'Créer le modèle'}</button></div>
        </form>
        <div className="space-y-2">{templates.map((t:any) => (<div key={t.id} className="flex justify-between items-center bg-white p-3 border shadow-sm theme-card"><div><p className="font-bold text-sm flex items-center gap-2">{t.color && <span className="w-3 h-3 rounded-full" style={{backgroundColor: t.color}}></span>}{t.title}</p></div><div className="flex gap-1"><button onClick={() => {setEditingTplId(t.id); setNewTpl({title: t.title, loc: t.locationName, price: t.price, cap: t.maxCapacity, desc: t.description || '', externalLink: t.externalLink || '', color: t.color || ''});}} className="text-amber-500 p-2"><Edit2 size={16}/></button><button onClick={() => removeTemplate(t.id)} className="text-red-500 p-2"><Trash2 size={16}/></button></div></div>))}</div>
      </div>
    </div>
  );
};

const DevAdminTab = ({ themeSettings, users, devVis, setDevVis, simRole, setSimRole, simDate, setSimDate }: any) => {
  const [activeModule, setActiveModule] = useState('textes');
  const [settings, setSettings] = useState({
    logoUrl: themeSettings?.logoUrl || '',
    cardRadius: themeSettings?.cardRadius || '16px',
    btnRadius: themeSettings?.btnRadius || '12px',
    fontFamily: themeSettings?.fontFamily || 'ui-sans-serif, system-ui, sans-serif',
    fontSize: themeSettings?.fontSize || '16px',
    tabHome: themeSettings?.tabHome || 'Accueil',
    tabPlanning: themeSettings?.tabPlanning || 'Planning',
    tabHistory: themeSettings?.tabHistory || 'Mon Historique',
  });
  const [selectedUser, setSelectedUser] = useState(''); const [popupMessage, setPopupMessage] = useState(''); const [loading, setLoading] = useState(false);

  const handleChange = (k:string, v:string) => setSettings(prev => ({...prev, [k]: v}));
  const handleSaveTheme = async () => { await setDoc(doc(db, "settings", "theme"), settings, { merge: true }); alert("Modifications appliquées en temps réel à tout le site !"); };
  const handleSendPopup = async (e: React.FormEvent) => { e.preventDefault(); if (!selectedUser || !popupMessage) return; setLoading(true); try { await updateDoc(doc(db, "users", selectedUser), { pendingPopup: popupMessage }); alert("Pop-up programmée avec succès !"); setPopupMessage(''); setSelectedUser(''); } catch (e) { alert("Erreur."); } setLoading(false); };

  return (
    <div className="p-8 rounded-3xl shadow-xl text-left text-white mt-8" style={{fontFamily: 'sans-serif', backgroundColor: '#111827', borderColor: '#1f2937', borderWidth: '1px'}}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div><h2 className="font-black mb-1 flex items-center gap-3 text-2xl" style={{color: '#60a5fa'}}><Code size={28}/> Espace Développeur</h2><p className="text-sm text-gray-400">Cockpit avancé : Tests, affichage et design.</p></div>
        <button onClick={handleSaveTheme} className="font-black py-3 px-6 rounded-xl shadow-lg transition-colors w-full md:w-auto" style={{backgroundColor: '#2563eb', color: 'white'}}>Publier le design</button>
      </div>
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-1/4 flex flex-col gap-2">
          {[ {id:'textes', icon:<Type size={18}/>, name:'Textes & Logo'}, {id:'formes', icon:<Square size={18}/>, name:'Bordures & Arrondis'}, {id:'popup', icon:<Bell size={18}/>, name:'Pop-up Élève'}, {id:'visibilite', icon:<EyeOff size={18}/>, name:'Visibilité Dev'}, {id:'simulateur', icon:<Ghost size={18}/>, name:'Simulateur'} ].map(mod => (
            <button key={mod.id} onClick={() => setActiveModule(mod.id)} className={`w-full text-left px-4 py-3 rounded-xl font-bold flex items-center gap-3 transition-colors`} style={{backgroundColor: activeModule === mod.id ? '#2563eb' : '#1f2937', color: activeModule === mod.id ? 'white' : '#9ca3af'}}>{mod.icon} {mod.name}</button>
          ))}
        </div>
        <div className="w-full lg:w-3/4 p-6 rounded-2xl min-h-[400px]" style={{backgroundColor: '#1f2937', borderColor: '#374151', borderWidth: '1px'}}>
          {activeModule === 'textes' && (
            <div className="space-y-6 animate-in fade-in">
              <h4 className="font-bold text-white text-lg border-b border-gray-700 pb-2">Polices & Textes</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Police d'écriture</label><select value={settings.fontFamily} onChange={e=>handleChange('fontFamily', e.target.value)} className="w-full p-3 rounded-xl text-white outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}}><option value="ui-sans-serif, system-ui, sans-serif">Classique (Moderne)</option><option value="'Playfair Display', serif">Élégant (Serif)</option><option value="'Montserrat', sans-serif">Chic (Montserrat)</option><option value="'Nunito', sans-serif">Arrondi (Nunito)</option></select></div>
                <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Taille globale du texte</label><select value={settings.fontSize} onChange={e=>handleChange('fontSize', e.target.value)} className="w-full p-3 rounded-xl text-white outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}}><option value="14px">Petit (14px)</option><option value="16px">Normal (16px)</option><option value="18px">Grand (18px)</option></select></div>
              </div>
              <h4 className="font-bold text-white text-lg border-b border-gray-700 pb-2 mt-8">Noms des Onglets Élèves</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Onglet 1 (Accueil)</label><input value={settings.tabHome} onChange={e=>handleChange('tabHome', e.target.value)} className="w-full p-3 rounded-xl text-white text-sm outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}} /></div>
                <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Onglet 2 (Planning)</label><input value={settings.tabPlanning} onChange={e=>handleChange('tabPlanning', e.target.value)} className="w-full p-3 rounded-xl text-white text-sm outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}} /></div>
                <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Onglet 3 (Historique)</label><input value={settings.tabHistory} onChange={e=>handleChange('tabHistory', e.target.value)} className="w-full p-3 rounded-xl text-white text-sm outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}} /></div>
              </div>
              <h4 className="font-bold text-white text-lg border-b border-gray-700 pb-2 mt-8">Identité Visuelle</h4>
              <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Lien de votre Logo (Remplace l'avatar)</label><input value={settings.logoUrl} onChange={e=>handleChange('logoUrl', e.target.value)} placeholder="Ex: https://i.postimg.cc/mon-logo.png" className="w-full p-3 rounded-xl text-white text-sm outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}} /></div>
            </div>
          )}
          {activeModule === 'formes' && (
            <div className="space-y-6 animate-in fade-in">
              <h4 className="font-bold text-white text-lg border-b border-gray-700 pb-2">Bordures & Arrondis</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Forme des Cartes</label>
                  <select value={settings.cardRadius} onChange={e=>handleChange('cardRadius', e.target.value)} className="w-full p-3 rounded-xl text-white outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}}><option value="0px">Carré Parfait (0px)</option><option value="8px">Légèrement Arrondi (8px)</option><option value="16px">Arrondi Standard (16px)</option><option value="24px">Très Arrondi (24px)</option><option value="32px">Ovale (32px)</option></select>
                  <div className="mt-6 p-6 border-2 flex flex-col items-center justify-center text-gray-400 shadow-xl transition-all duration-300 h-32" style={{borderRadius: settings.cardRadius, borderColor: '#374151', backgroundColor: '#111827'}}><span>Aperçu de Carte</span></div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Forme des Boutons</label>
                  <select value={settings.btnRadius} onChange={e=>handleChange('btnRadius', e.target.value)} className="w-full p-3 rounded-xl text-white outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}}><option value="0px">Carré Parfait (0px)</option><option value="8px">Légèrement Arrondi (8px)</option><option value="12px">Arrondi Standard (12px)</option><option value="99px">Bouton Pilule (Rond 99px)</option></select>
                  <div className="mt-6 p-6 flex flex-col items-center justify-center rounded-2xl shadow-inner h-32" style={{backgroundColor: '#111827', borderColor: '#374151', borderWidth: '1px'}}>
                     <button className="px-8 py-3 font-bold transition-all duration-300 shadow-lg text-white" style={{backgroundColor: '#f59e0b', borderRadius: settings.btnRadius}}>Bouton d'Aperçu</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeModule === 'popup' && (
            <div className="space-y-4 animate-in fade-in">
              <h4 className="font-bold text-white text-lg border-b border-gray-700 pb-2 flex items-center gap-2"><Bell className="text-blue-400"/> Forcer une Pop-up Élève</h4>
              <p className="text-sm text-gray-400 mb-6">Bloque l'écran d'un élève spécifique à sa prochaine connexion.</p>
              <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Sélectionner l'élève cible</label><select value={selectedUser} onChange={e=>setSelectedUser(e.target.value)} className="w-full p-4 rounded-xl text-white outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}}><option value="">-- Choisir dans la liste --</option>{users.filter((u:any) => u.role !== 'dev-admin').map((u:any) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}</select></div>
              <div><label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Message d'alerte à afficher</label><textarea value={popupMessage} onChange={e=>setPopupMessage(e.target.value)} placeholder="Ex: N'oublie pas ton certificat médical !" className="w-full p-4 rounded-xl text-white min-h-[120px] outline-none focus:border-blue-500" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}} /></div>
              <button onClick={handleSendPopup} disabled={loading || !selectedUser || !popupMessage} className="text-white font-bold py-4 px-8 rounded-xl disabled:opacity-50 mt-4 transition-colors w-full md:w-auto" style={{backgroundColor: '#2563eb'}}>Programmer l'affichage</button>
            </div>
          )}
          {activeModule === 'visibilite' && (
            <div className="space-y-6 animate-in fade-in">
              <h4 className="font-bold text-white text-lg border-b border-gray-700 pb-2 flex items-center gap-2"><EyeOff className="text-blue-400"/> Nettoyage de l'interface Dev</h4>
              <p className="text-sm text-gray-400 mb-6">Ces réglages ne s'appliquent qu'à <b>TOI</b>. Ils permettent de cacher les éléments inutiles pour le développement.</p>
              <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-700">
                 <label className="flex items-center justify-between cursor-pointer">
                   <div><p className="font-bold">Cacher l'En-tête (Header)</p><p className="text-[10px] text-gray-500">Masque le logo, "Bonjour", et les boutons profil/déconnexion.</p></div>
                   <input type="checkbox" checked={devVis.hideHeader} onChange={e=>setDevVis({...devVis, hideHeader: e.target.checked})} className="w-5 h-5 accent-blue-500" />
                 </label>
                 <hr className="border-gray-800"/>
                 <label className="flex items-center justify-between cursor-pointer">
                   <div><p className="font-bold">Cacher les Boutons Rapides</p><p className="text-[10px] text-gray-500">Masque Insta, Crédits, Boutique et Cloche.</p></div>
                   <input type="checkbox" checked={devVis.hideIcons} onChange={e=>setDevVis({...devVis, hideIcons: e.target.checked})} className="w-5 h-5 accent-blue-500" />
                 </label>
                 <hr className="border-gray-800"/>
                 <label className="flex items-center justify-between cursor-pointer">
                   <div><p className="font-bold">Cacher les Onglets Élèves</p><p className="text-[10px] text-gray-500">Masque Accueil, Planning, Mon Historique.</p></div>
                   <input type="checkbox" checked={devVis.hideTabs} onChange={e=>setDevVis({...devVis, hideTabs: e.target.checked})} className="w-5 h-5 accent-blue-500" />
                 </label>
              </div>
            </div>
          )}
          {activeModule === 'simulateur' && (
            <div className="space-y-6 animate-in fade-in">
              <h4 className="font-bold text-white text-lg border-b border-gray-700 pb-2 flex items-center gap-2"><Ghost className="text-blue-400"/> Machine à voyager (Tests)</h4>
              <p className="text-sm text-gray-400 mb-6">Modifie temporairement la réalité de l'application pour tester tes fonctionnalités. <b>Un bouton rouge apparaîtra pour te permettre de quitter ce mode.</b></p>
              <div className="space-y-4 bg-gray-900 p-6 rounded-xl border border-gray-700">
                <div>
                  <label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Simuler une date précise</label>
                  <input type="date" value={simDate} onChange={e=>setSimDate(e.target.value)} className="w-full p-3 rounded-xl text-white outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}} />
                  <p className="text-[10px] text-gray-500 mt-1">Utile pour voir le bandeau "J-1" ou le clignotement "Cours du jour".</p>
                </div>
                <div className="pt-4 border-t border-gray-800">
                  <label className="text-xs text-gray-400 block mb-2 uppercase tracking-wider">Simuler un Rôle</label>
                  <select value={simRole} onChange={e=>setSimRole(e.target.value)} className="w-full p-3 rounded-xl text-white outline-none" style={{backgroundColor: '#111827', borderColor: '#4b5563', borderWidth: '1px'}}>
                    <option value="">Mon vrai rôle (Dev-Admin)</option>
                    <option value="admin">Administratrice (Cheffe)</option>
                    <option value="student">Élève Basique</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- MODALES INVISIBLES ---
const BoutiqueModal = ({ isOpen, onClose, user, packs }: any) => {
  if (!isOpen) return null; const activeCreds = getActiveCredits(user);
  const handleBuy = async (pack: CreditPackTemplate) => {
    if (!window.confirm(`Acheter "${pack.name}" pour ${pack.price}€ ?`)) return;
    try { await addDoc(collection(db, "credit_purchases"), { userId: user.id, userName: user.displayName, packId: pack.id, packName: pack.name, qty: pack.qty, price: pack.price, validityDays: pack.validityDays, date: new Date().toISOString(), paymentMethod: 'WERO_RIB', status: 'PENDING' }); await sendNotification(`Nouvelle commande de crédits (${pack.name}) par ${user.displayName}`, 'BOUTIQUE'); alert("Commande enregistrée ! Effectue le paiement."); onClose(); } catch (e) {}
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 text-left"><div className="bg-white p-6 max-w-md w-full shadow-2xl relative theme-card"><h3 className="text-2xl font-black text-gray-900 mb-2 flex items-center gap-2"><ShoppingBag className="text-amber-500"/> Boutique</h3><p className="text-gray-500 text-sm mb-6">Tu as actuellement <span className="font-bold text-amber-600">{activeCreds} crédits</span> valides.</p>{packs.length === 0 ? <p className="text-gray-400">Aucune offre disponible.</p> : (<div className="space-y-4">{packs.map((p:any) => (<div key={p.id} className="border border-gray-200 p-4 flex justify-between items-center bg-gray-50 theme-card"><div><h4 className="font-bold text-gray-800">{p.name}</h4><p className="text-xs text-gray-500">Valable {p.validityDays} jours</p></div><div className="text-right flex flex-col items-end gap-2"><span className="text-lg font-black text-amber-600">{p.price} €</span><button onClick={() => handleBuy(p)} className="bg-amber-500 text-white text-xs font-bold px-4 py-2 theme-btn">Commander</button></div></div>))}</div>)}<button onClick={onClose} className="mt-6 w-full py-3 bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 theme-btn">Fermer</button></div></div>
  );
};

const PaymentInfoModal = ({ isOpen, onClose }: any) => {
  if (!isOpen) return null; return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 text-left"><div className="bg-white p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200 theme-card"><h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2"><Wallet className="text-amber-600"/> Moyens de paiement</h3><p className="text-sm text-gray-600 mb-4">Tu peux régler ton cours dès maintenant via :</p><div className="bg-gray-50 p-4 border border-gray-200 mb-4 space-y-4 theme-card"><div><span className="font-bold text-gray-800 flex items-center gap-2"><Smartphone size={16} className="text-blue-500"/> Wero/PayPal :</span><p className="text-lg font-mono font-bold text-gray-700 mt-1 select-all">0621056414</p></div><hr className="border-gray-200"/><div><span className="font-bold text-gray-800 flex items-center gap-2"><Building size={16} className="text-indigo-500"/> Virement :</span><p className="text-sm font-mono font-bold text-gray-700 mt-1 break-all select-all">FR2120041010052736887X02624</p></div></div><div className="bg-amber-50 text-amber-800 p-3 text-sm font-bold flex items-start gap-2 border border-amber-100 theme-card"><AlertTriangle size={18} className="shrink-0 mt-0.5" /><p>Ajout obligatoire du motif :<br/><span className="text-amber-900 font-black">Nom prénom + date du cours</span></p></div><button onClick={onClose} className="mt-6 w-full py-3 bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors theme-btn">Fermer</button></div></div>);
};

const PaymentModal = ({ isOpen, onClose, onConfirm, userCredits }: any) => {
  if (!isOpen) return null; return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 text-left"><div className="bg-white p-6 max-w-sm w-full shadow-2xl theme-card"><h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2"><Wallet className="text-amber-600"/> Paiement</h3><div className="space-y-3"><button onClick={() => onConfirm('CREDIT')} disabled={userCredits < 1} className={`w-full p-4 border-2 flex justify-between items-center theme-btn ${userCredits >= 1 ? 'border-amber-100 bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-400'}`}><div className="flex items-center gap-3"><Zap size={20}/> <span className="font-bold">1 Crédit</span></div><span className="text-xs">Solde: {userCredits}</span></button><button onClick={() => onConfirm('CASH')} className="w-full p-4 border-2 border-gray-100 hover:bg-green-50 text-gray-700 flex gap-3 theme-btn"><span className="font-bold">Espèces (Sur place)</span></button><button onClick={() => onConfirm('WERO_RIB')} className="w-full p-4 border-2 border-gray-100 hover:bg-blue-50 text-gray-700 flex gap-3 theme-btn"><span className="font-bold">Virement / Wero</span></button></div><button onClick={onClose} className="mt-6 w-full py-3 text-gray-500 font-bold hover:bg-gray-100 transition-colors theme-btn">Annuler</button></div></div>);
};

const UserProfileForm = ({ user, onClose }: any) => {
  const isFirstTime = !user.hasFilledForm;
  const [formData, setFormData] = useState({ birthDate: user.birthDate || '', street: user.street || '', zipCode: user.zipCode || '', city: user.city || '', phone: user.phone || '', emergencyContact: user.emergencyContact || '', emergencyPhone: user.emergencyPhone || '' });
  const [health1, setHealth1] = useState(false); const [health2, setHealth2] = useState(false); const [health3, setHealth3] = useState(false); const [imageRights, setImageRights] = useState<'yes' | 'no' | null>(user.imageRights || null); const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); if (isFirstTime) { if (!health1 || !health2 || !health3) return alert("⚠️ Tu dois obligatoirement cocher les 3 cases concernant l'état de santé."); if (!imageRights) return alert("⚠️ Tu dois indiquer ton choix concernant le droit à l'image."); }
    setSaving(true); try { await updateDoc(doc(db, "users", user.id), { ...formData, hasFilledForm: true, imageRights, legalAccepted: true }); await syncToSheet({ type: 'PROFILE', id: user.id, displayName: user.displayName, email: user.email, credits: user.credits, imageRights, legalAccepted: true, adminMemo: user.adminMemo || '', ...formData }); if (isFirstTime) { sendNotification(`Nouvel élève inscrit : ${user.displayName}`, 'NEW_STUDENT'); alert("Bienvenue ! Profil complet. 🎉"); } else alert("Profil mis à jour ! ✅"); onClose(); } catch (e) { alert("Erreur."); } setSaving(false);
  };
  return (<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 text-left"><div className="bg-white p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto relative theme-card"><h2 className="text-2xl font-black text-gray-800 mb-2 flex items-center gap-2"><User className="text-amber-600"/> {isFirstTime ? 'Inscription' : 'Mon Profil'}</h2>{isFirstTime && <p className="text-sm text-gray-500 mb-4">Dernière étape avant de pouvoir réserver !</p>}<form onSubmit={handleSave} className="space-y-4 mt-4"><div className="bg-gray-50 p-3 mb-4 text-sm text-gray-500 border theme-card"><p className="font-bold text-gray-800">{user.displayName}</p><p>{user.email}</p></div><div className="space-y-3"><h3 className="font-bold flex items-center gap-2"><Phone size={16} className="text-blue-500"/> Date de Naissance et Téléphone</h3><div className="flex gap-2"><input type="date" required value={formData.birthDate} onChange={e => setFormData({...formData, birthDate: e.target.value})} className="w-1/2 p-3 border outline-none focus:border-amber-500 theme-btn" title="Date de naissance" /><input required placeholder="Téléphone *" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-1/2 p-3 border outline-none focus:border-amber-500 theme-btn" /></div><h3 className="font-bold flex items-center gap-2 mt-4"><Home size={16} className="text-indigo-500"/> Adresse</h3><input required placeholder="Numéro et Rue *" value={formData.street} onChange={e => setFormData({...formData, street: e.target.value})} className="w-full p-3 border outline-none focus:border-amber-500 theme-btn" /><div className="flex gap-2"><input required placeholder="Code Postal *" value={formData.zipCode} onChange={e => setFormData({...formData, zipCode: e.target.value})} className="w-1/3 p-3 border outline-none focus:border-amber-500 theme-btn" /><input required placeholder="Ville *" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-2/3 p-3 border outline-none focus:border-amber-500 theme-btn" /></div></div><div className="space-y-3 mt-4 pt-4 border-t"><h3 className="font-bold flex items-center gap-2"><HeartPulse size={16} className="text-red-500"/> Contact d'Urgence</h3><input required placeholder="Nom personne à prévenir *" value={formData.emergencyContact} onChange={e => setFormData({...formData, emergencyContact: e.target.value})} className="w-full p-3 border outline-none focus:border-red-500 theme-btn" /><input required placeholder="Téléphone d'urgence *" value={formData.emergencyPhone} onChange={e => setFormData({...formData, emergencyPhone: e.target.value})} className="w-full p-3 border outline-none focus:border-red-500 theme-btn" /></div>{isFirstTime && (<div className="mt-6 pt-6 border-t space-y-5"><div><h3 className="font-bold text-lg">État de santé et décharge</h3><p className="text-xs text-red-500 font-bold mb-3 mt-1">Je confirme (Obligatoire) :</p><div className="space-y-3"><label className="flex items-start gap-3"><input type="checkbox" checked={health1} onChange={e => setHealth1(e.target.checked)} className="mt-1 w-5 h-5 accent-amber-500" required={isFirstTime} /><span className="text-sm">Être en bonne condition physique et n'avoir aucune contre-indication.</span></label><label className="flex items-start gap-3"><input type="checkbox" checked={health2} onChange={e => setHealth2(e.target.checked)} className="mt-1 w-5 h-5 accent-amber-500" required={isFirstTime} /><span className="text-sm">Avoir conscience des risques liés à la pole dance (bleus, glissades).</span></label><label className="flex items-start gap-3"><input type="checkbox" checked={health3} onChange={e => setHealth3(e.target.checked)} className="mt-1 w-5 h-5 accent-amber-500" required={isFirstTime} /><span className="text-sm">Être couverte par ma propre assurance RC.</span></label></div></div><div className="pt-2"><h3 className="font-bold text-lg">Droit à l'image</h3><p className="text-xs text-gray-500 font-bold mb-3 mt-1">Acceptes-tu d'apparaître sur les réseaux ? *</p><div className="space-y-3"><label className="flex items-start gap-3"><input type="radio" name="imageRights" value="yes" checked={imageRights === 'yes'} onChange={() => setImageRights('yes')} className="mt-1 w-5 h-5 accent-amber-500" required={isFirstTime} /><span className="text-sm">Oui, j'accepte que des photos/vidéos soient publiées.</span></label><label className="flex items-start gap-3"><input type="radio" name="imageRights" value="no" checked={imageRights === 'no'} onChange={() => setImageRights('no')} className="mt-1 w-5 h-5 accent-amber-500" required={isFirstTime} /><span className="text-sm">Non, je préfère ne pas apparaître.</span></label></div></div></div>)}<div className="pt-6 flex gap-3">{!isFirstTime && <button type="button" onClick={onClose} className="flex-1 py-3.5 bg-gray-100 font-bold theme-btn">Annuler</button>}<button type="submit" disabled={saving} className="flex-[2] py-3.5 bg-amber-500 text-white font-bold shadow-lg disabled:opacity-50 theme-btn">{saving ? <Loader2 className="animate-spin mx-auto" size={20}/> : isFirstTime ? 'Terminer mon inscription' : 'Enregistrer'}</button></div></form></div></div>);
};

const LoginScreen = () => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState('');
  const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => { e.preventDefault(); setError(''); setMsg(''); setLoading(true); try { await signInWithEmailAndPassword(auth, email, password); } catch (err) { setError('Email ou mot de passe incorrect.'); setLoading(false); } };
  
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setMsg(''); setLoading(true);
    if (password !== confirmPassword) { setError('Les mots de passe ne correspondent pas.'); setLoading(false); return; }
    if (!firstName || !lastName) { setError('Veuillez renseigner votre nom et prénom.'); setLoading(false); return; }
    if (password.length < 6) { setError('Le mot de passe doit faire au moins 6 caractères.'); setLoading(false); return; }
    
    const domain = email.trim().toLowerCase().split('@')[1];
    const forbiddenDomains = ['yopmail.com', 'yopmail.fr', 'tempmail.com', '10minutemail.com', 'mailinator.com', 'guerrillamail.com', 'trashmail.com', 'jetable.org'];
    try { const res = await fetch('https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf'); const text = await res.text(); if (text.includes(domain) || forbiddenDomains.includes(domain)) { setError("⚠️ Les adresses email jetables ou temporaires sont interdites."); setLoading(false); return; } } catch (err) { if (forbiddenDomains.includes(domain)) { setError("⚠️ Les adresses email jetables ne sont pas autorisées."); setLoading(false); return; } }

    try { const userCred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password); const fullName = `${firstName.trim()} ${lastName.trim()}`; await updateProfile(userCred.user, { displayName: fullName }); await setDoc(doc(db, "users", userCred.user.uid), { displayName: fullName, email: email.trim().toLowerCase(), role: 'student', credits: 0, hasFilledForm: false }, { merge: true }); } catch (err: any) { if (err.code === 'auth/email-already-in-use') setError('Cet email est déjà utilisé.'); else setError('Erreur lors de la création du compte.'); setLoading(false); }
  };
  
  const handleReset = async (e: React.FormEvent) => { e.preventDefault(); setError(''); setMsg(''); setLoading(true); try { await sendPasswordResetEmail(auth, email.trim().toLowerCase()); setMsg('Lien envoyé par email (Vérifiez vos spams).'); } catch (err) { setError('Erreur. Vérifiez que cette adresse email est correcte.'); } setLoading(false); };

  return (<div className="min-h-screen bg-gray-900 flex items-center justify-center p-4"><div className="bg-white p-8 shadow-2xl max-w-md w-full text-center theme-card"><div className="bg-white p-2 rounded-full shadow-sm mb-4 inline-block"><img src="/logo.png" alt="Logo" className="w-32 h-32 object-contain mx-auto"/></div><h1 className="text-2xl font-bold text-gray-800 mb-6">Vertic'Ali</h1>{error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-xl font-medium border border-red-100">{error}</div>}{msg && <div className="mb-4 p-3 bg-green-50 text-green-600 text-sm rounded-xl font-medium border border-green-100">{msg}</div>}{mode === 'login' && (<form onSubmit={handleLogin} className="space-y-4"><input type="email" required placeholder="Adresse Email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full p-3 border outline-none focus:border-amber-500 theme-btn" /><input type="password" required placeholder="Mot de passe" value={password} onChange={e=>setPassword(e.target.value)} className="w-full p-3 border outline-none focus:border-amber-500 theme-btn" /><button type="submit" disabled={loading} className="w-full py-3.5 bg-gray-900 text-white font-bold disabled:opacity-50 theme-btn">Se connecter</button><div className="flex justify-between items-center text-sm mt-4 px-1"><button type="button" onClick={() => {setMode('reset'); setError(''); setMsg('');}} className="text-gray-500 hover:text-amber-600 font-medium">Mot de passe oublié ?</button><button type="button" onClick={() => {setMode('register'); setError(''); setMsg('');}} className="text-amber-600 font-bold hover:text-amber-700">Créer un compte</button></div></form>)}{mode === 'register' && (<form onSubmit={handleRegister} className="space-y-3"><div className="flex gap-2"><input type="text" required placeholder="Prénom" value={firstName} onChange={e=>setFirstName(e.target.value)} className="w-1/2 p-3 border outline-none focus:border-amber-500 theme-btn" /><input type="text" required placeholder="Nom" value={lastName} onChange={e=>setLastName(e.target.value)} className="w-1/2 p-3 border outline-none focus:border-amber-500 theme-btn" /></div><input type="email" required placeholder="Adresse Email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full p-3 border outline-none focus:border-amber-500 theme-btn" /><input type="password" required placeholder="Mot de passe (min 6 car.)" value={password} onChange={e=>setPassword(e.target.value)} className="w-full p-3 border outline-none focus:border-amber-500 theme-btn" /><input type="password" required placeholder="Confirmez le mot de passe" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} className="w-full p-3 border outline-none focus:border-amber-500 theme-btn" /><button type="submit" disabled={loading} className="w-full py-3.5 bg-amber-500 text-white font-bold disabled:opacity-50 mt-2 theme-btn">Créer mon compte</button><button type="button" onClick={() => {setMode('login'); setError(''); setMsg('');}} className="text-sm text-gray-500 hover:text-gray-800 mt-4 block w-full font-medium">Déjà un compte ? Se connecter</button></form>)}{mode === 'reset' && (<form onSubmit={handleReset} className="space-y-4"><p className="text-sm text-gray-600 mb-4 font-medium">Entrez votre email pour recevoir un lien de réinitialisation.</p><input type="email" required placeholder="Votre Adresse Email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full p-3 border outline-none focus:border-amber-500 theme-btn" /><button type="submit" disabled={loading} className="w-full py-3.5 bg-gray-900 text-white font-bold disabled:opacity-50 theme-btn">Envoyer le lien</button><button type="button" onClick={() => {setMode('login'); setError(''); setMsg('');}} className="text-sm text-gray-500 hover:text-gray-800 mt-4 block w-full font-medium">Retour à la connexion</button></form>)}<div className="mt-8 pt-6 border-t border-gray-100"><button type="button" onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold py-3.5 px-4 flex items-center justify-center gap-3 transition-colors shadow-sm theme-btn"><img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" /> {mode === 'register' ? 'S\'inscrire avec Google' : 'Continuer avec Google'}</button></div></div></div>);
};

export default function App() {
  // L'ÉTAT DU SIMULATEUR (MACHINE À VOYAGER / MODE FANTÔME)
  const [simulatedDate, setSimulatedDate] = useState<string>('');
  const [simulatedRole, setSimulatedRole] = useState<string>('');
  const [impersonatedUserId, setImpersonatedUserId] = useState<string>('');
  const [devVis, setDevVis] = useState({ hideHeader: false, hideIcons: false, hideTabs: false });

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null); const [authUser, setAuthUser] = useState<FirebaseUser | null>(null); const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'accueil'|'planning'|'history'|'admin_dashboard'|'admin_invoices'|'admin_students'|'admin_past'|'admin_settings'|'dev_admin'|'admin_today'>('accueil');
  const [classes, setClasses] = useState<DanceClass[]>([]); const [pastClasses, setPastClasses] = useState<DanceClass[]>([]);
  const [locations, setLocations] = useState<StudioLocation[]>([]); const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [creditPacks, setCreditPacks] = useState<CreditPackTemplate[]>([]); const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({ reminderDays: 3 });
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>({});
  const [allPurchases, setAllPurchases] = useState<CreditPurchase[]>([]); const [allBookings, setAllBookings] = useState<BookingInfo[]>([]);
  const [myBookings, setMyBookings] = useState<BookingInfo[]>([]); const [myPurchases, setMyPurchases] = useState<CreditPurchase[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]); const [showNotifications, setShowNotifications] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null); const [showProfile, setShowProfile] = useState(false);
  const [paymentModal, setPaymentModal] = useState<{isOpen: boolean, classId: string | null}>({isOpen: false, classId: null});
  const [isBoutiqueOpen, setBoutiqueOpen] = useState(false); const [isPaymentInfoOpen, setPaymentInfoOpen] = useState(false); const [bookingSuccessData, setBookingSuccessData] = useState<DanceClass | null>(null);
  const [editingClass, setEditingClass] = useState<DanceClass | null>(null);
  const [devUsers, setDevUsers] = useState<UserProfile[]>([]);
  
  // CALCUL DES RÔLES EFFECTIFS (Avec le Simulateur)
  const isRealDevAdmin = userProfile?.role === 'dev-admin';
  const effectiveUser = impersonatedUserId ? devUsers.find(u => u.id === impersonatedUserId) || userProfile : userProfile;
  const isAdmin = simulatedRole === 'admin' || (simulatedRole === '' && (effectiveUser?.role === 'admin' || effectiveUser?.role === 'dev-admin'));
  const todayDate = simulatedDate ? new Date(simulatedDate) : new Date();
  
  const hasPendingPayments = myBookings.some(b => b.paymentStatus === 'PENDING') || myPurchases.some(p => p.status === 'PENDING');
  const [hasInvoiceAlert, setHasInvoiceAlert] = useState(false);

  useEffect(() => {
    if (isAdmin) { const now = todayDate.getTime(); const alert = allBookings.some(b => { if (b.paymentMethod === 'CREDIT') return false; const isPast = new Date(b.date).getTime() < now; if (b.paymentStatus === 'PENDING' && isPast) return true; if (b.paymentStatus === 'PAID' && !b.invoiceDownloaded) return true; return false; }) || allPurchases.some(p => p.status === 'PENDING'); setHasInvoiceAlert(alert); }
  }, [allPurchases, allBookings, isAdmin, simulatedDate]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (user) {
        const userRef = doc(db, "users", user.uid);
        onSnapshot(userRef, async (snap) => {
          if (snap.exists()) { setUserProfile({ id: snap.id, ...snap.data() } as UserProfile); } else {
             const emailQ = query(collection(db, "users"), where("email", "==", user.email)); const emailSnap = await getDocs(emailQ);
             if (!emailSnap.empty) {
                const oldDoc = emailSnap.docs[0]; const oldData = oldDoc.data();
                await setDoc(userRef, { ...oldData, id: user.uid, displayName: user.displayName }); await deleteDoc(doc(db, "users", oldDoc.id));
                const bQ = await getDocs(query(collection(db, "bookings"), where("userId", "==", oldDoc.id))); bQ.forEach(b => updateDoc(doc(db, "bookings", b.id), { userId: user.uid }));
                const pQ = await getDocs(query(collection(db, "credit_purchases"), where("userId", "==", oldDoc.id))); pQ.forEach(p => updateDoc(doc(db, "credit_purchases", p.id), { userId: user.uid }));
             } else {
                const newUser = { email: user.email, displayName: user.displayName, credits: 0, role: 'student', hasFilledForm: false }; setDoc(userRef, newUser); syncToSheet({ type: 'PROFILE', id: user.uid, ...newUser });
             }
          }
        });
      } else setUserProfile(null);
      setAuthLoading(false);
    }); return () => unsub();
  }, []);

  useEffect(() => {
    if (isAdmin) {
       if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
       let isInitialLoad = true;
       const notifUnsub = onSnapshot(query(collection(db, "notifications"), orderBy("date", "desc"), limit(20)), (nsnap) => {
          setNotifications(nsnap.docs.map(d => ({id: d.id, ...d.data()} as AppNotification)));
          if (!isInitialLoad && "Notification" in window && Notification.permission === "granted") { nsnap.docChanges().forEach((change) => { if (change.type === "added") { const data = change.doc.data(); if (Date.now() - new Date(data.date).getTime() < 120000) new Notification("Vertic'Ali", { body: data.text, icon: "/logo.png" }); } }); }
          isInitialLoad = false;
       });
       const unsubP = onSnapshot(query(collection(db, "credit_purchases")), snap => setAllPurchases(snap.docs.map(d => ({id: d.id, ...d.data()} as CreditPurchase))));
       const unsubB = onSnapshot(query(collection(db, "bookings")), snap => setAllBookings(snap.docs.map(d => ({id: d.id, ...d.data()} as BookingInfo))));
       return () => { notifUnsub(); unsubP(); unsubB(); };
    }
  }, [isAdmin]);

  const fetchAllData = async () => { const snap = await getDocs(query(collection(db, "classes"), orderBy("startAt", "asc"))); const all = snap.docs.map(d => ({ id: d.id, ...d.data(), attendeeIds: d.data().attendeeIds || [], startAt: d.data().startAt?.toDate(), endAt: d.data().endAt?.toDate() } as DanceClass)); setClasses(all.filter(c => c.endAt && c.endAt > todayDate)); setPastClasses(all.filter(c => c.endAt && c.endAt <= todayDate).reverse()); };
  
  useEffect(() => { 
    fetchAllData(); 
    onSnapshot(doc(db, "settings", "general"), (docSnap) => { if (docSnap.exists()) { const data = docSnap.data(); setLocations(data.locations || []); setTemplates(data.templates || []); setCreditPacks(data.creditPacks || []); setGlobalSettings({ reminderDays: data.reminderDays !== undefined ? data.reminderDays : 3, welcomeText: data.welcomeText || '', welcomeImageUrl: data.welcomeImageUrl || '', welcomeTextSize: data.welcomeTextSize || 18, welcomeImageSize: data.welcomeImageSize || 50 }); } else setDoc(doc(db, "settings", "general"), { locations: [], templates: [], creditPacks: [], reminderDays: 3, welcomeText: '', welcomeImageUrl: '' }); }); 
    onSnapshot(doc(db, "settings", "theme"), (docSnap) => { if (docSnap.exists()) setThemeSettings(docSnap.data() as ThemeSettings); });
  }, [simulatedDate]);

  useEffect(() => { if (effectiveUser) { const unsubBookings = onSnapshot(query(collection(db, "bookings"), where("userId", "==", effectiveUser.id)), (snap) => { setMyBookings(snap.docs.map(d => ({ id: d.id, ...d.data() } as BookingInfo))); }); const unsubPurchases = onSnapshot(query(collection(db, "credit_purchases"), where("userId", "==", effectiveUser.id)), (snap) => { setMyPurchases(snap.docs.map(d => ({ id: d.id, ...d.data() } as CreditPurchase))); }); return () => { unsubBookings(); unsubPurchases(); }; } }, [effectiveUser]);
  useEffect(() => { if (isRealDevAdmin) { const unsubUsers = onSnapshot(query(collection(db, "users")), (snap) => setDevUsers(snap.docs.map(d => ({id: d.id, ...d.data()} as UserProfile)))); return () => unsubUsers(); } }, [isRealDevAdmin]);

  const userTimeline = [ ...myBookings.map(b => ({ type: 'BOOKING', dateObj: new Date(b.date), data: b })), ...myPurchases.map(p => ({ type: 'PACK', dateObj: new Date(p.date), data: p })) ].sort((a,b) => b.dateObj.getTime() - a.dateObj.getTime());
  const initiateBooking = (classId: string) => setPaymentModal({ isOpen: true, classId });
  const confirmBooking = async (method: PaymentMethod) => {
    const classId = paymentModal.classId; if (!classId || !effectiveUser) return; setPaymentModal({ isOpen: false, classId: null }); setProcessingId(classId);
    try {
      await runTransaction(db, async (t) => {
        const classRef = doc(db, "classes", classId); const userRef = doc(db, "users", effectiveUser.id); const classDoc = await t.get(classRef); const userDoc = await t.get(userRef); const classData = classDoc.data(); const userData = userDoc.data() as UserProfile;
        if (!classData || !userData) throw "Erreur DB"; if ((classData.attendeeIds || []).includes(effectiveUser.id)) throw "Déjà inscrit !"; if (classData.attendeesCount >= classData.maxCapacity) throw "Complet !";
        let newPacks = userData.creditPacks ? [...userData.creditPacks] : [];
        if (method === 'CREDIT') { const now = todayDate.getTime(); newPacks = newPacks.filter(p => new Date(p.expiresAt).getTime() > now).sort((a,b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()); const validPack = newPacks.find(p => p.remaining > 0); if (!validPack) throw "Aucun crédit valide !"; validPack.remaining -= 1; t.update(userRef, { creditPacks: newPacks }); }
        t.update(classRef, { attendeesCount: classData.attendeesCount + 1, attendeeIds: [...(classData.attendeeIds||[]), effectiveUser.id] });
        const paymentStatus = method === 'CREDIT' ? 'PAID' : 'PENDING'; const dateStr = classData.startAt.toDate().toLocaleDateString('fr-FR'); const timeStr = classData.startAt.toDate().toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}); const nowStr = todayDate.toISOString();
        t.set(doc(collection(db, "bookings")), { classId, userId: effectiveUser.id, userName: effectiveUser.displayName, classTitle: classData.title, date: classData.startAt.toDate().toISOString(), dateStr, timeStr, location: classData.location, price: classData.price || '', paymentMethod: method, paymentStatus, updatedAt: nowStr, paidAt: paymentStatus === 'PAID' ? nowStr : null });
        return { classTarget: { id: classId, ...classData, startAt: classData.startAt.toDate(), endAt: classData.endAt.toDate() } as DanceClass, dateStr, timeStr, method, paymentStatus };
      }).then((d) => { syncToSheet({ type: 'BOOKING', classId, classTitle: d.classTarget.title, date: d.dateStr, time: d.timeStr, location: d.classTarget.location, capacity: d.classTarget.maxCapacity, studentId: effectiveUser.id, studentName: `${effectiveUser.displayName} (${d.method})`, paymentStatus: d.paymentStatus, price: d.classTarget.price || '' }); sendNotification(`Nouvelle réservation : ${effectiveUser.displayName} pour ${d.classTarget.title}`, 'BOOKING'); setBookingSuccessData(d.classTarget); fetchAllData(); });
    } catch (e) { alert("Erreur: " + e); } setProcessingId(null);
  };
  const handleCancel = async (classId: string) => {
    if (!effectiveUser || !window.confirm("Annuler ta réservation ?")) return; setProcessingId(classId);
    try {
      const q = query(collection(db, "bookings"), where("classId", "==", classId), where("userId", "==", effectiveUser.id)); const snap = await getDocs(q); let method = 'CASH'; let bookingId = null; let pStatus = 'PENDING';
      if (!snap.empty) { bookingId = snap.docs[0].id; method = snap.docs[0].data().paymentMethod; pStatus = snap.docs[0].data().paymentStatus; }
      await runTransaction(db, async (t) => {
        const classRef = doc(db, "classes", classId); const userRef = doc(db, "users", effectiveUser.id); const classDoc = await t.get(classRef); const userDoc = await t.get(userRef); const classData = classDoc.data(); const userData = userDoc.data() as UserProfile;
        if (!classData || !userData) throw "Erreur DB"; if (method === 'CREDIT' && userData.creditPacks && userData.creditPacks.length > 0) { const updatedPacks = [...userData.creditPacks]; updatedPacks[0].remaining += 1; t.update(userRef, { creditPacks: updatedPacks }); }
        t.update(classRef, { attendeesCount: classData.attendeesCount - 1, attendeeIds: (classData.attendeeIds||[]).filter((id: string) => id !== effectiveUser.id) }); if (bookingId) t.delete(doc(db, "bookings", bookingId));
      });
      const cTarget = classes.find(c => c.id === classId) || pastClasses.find(c => c.id === classId);
      if(cTarget) { syncToSheet({ type: 'CANCEL', classId, studentId: effectiveUser.id, classTitle: cTarget.title, date: cTarget.startAt.toLocaleDateString('fr-FR'), time: cTarget.startAt.toLocaleTimeString('fr-FR'), location: cTarget.location, studentName: `${effectiveUser.displayName} (${method})`, price: cTarget.price || '', paymentStatus: pStatus }); sendNotification(`Annulation : ${effectiveUser.displayName} a annulé ${cTarget.title}`, 'CANCEL'); }
      alert("Réservation annulée !"); fetchAllData();
    } catch (e) { alert("Erreur: " + e); } setProcessingId(null);
  };
  const handleCancelBoutiqueOrder = async (id: string) => { if (!window.confirm("Es-tu sûre de vouloir annuler cette commande ?")) return; try { await deleteDoc(doc(db, "credit_purchases", id)); alert("Commande annulée !"); } catch(e) { alert("Erreur."); } };
  const markNotifRead = async (id: string) => { await updateDoc(doc(db, "notifications", id), { read: true }); };
  const closeUserPopup = async () => { if (!effectiveUser) return; try { await updateDoc(doc(db, "users", effectiveUser.id), { pendingPopup: '' }); setUserProfile({ ...userProfile, pendingPopup: '' } as UserProfile); } catch (e) { console.error(e); } };

  if (authLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-amber-600"/></div>;
  if (!authUser) return <LoginScreen />;

  const activeCreds = effectiveUser ? getActiveCredits(effectiveUser) : 0; 
  const unreadNotifs = notifications.filter(n => !n.read).length;
  const hasClassToday = classes.some(c => new Date(c.startAt).toLocaleDateString('fr-FR') === todayDate.toLocaleDateString('fr-FR'));

  const tomorrow = new Date(todayDate); tomorrow.setDate(tomorrow.getDate() + 1); const tomorrowStr = tomorrow.toLocaleDateString('fr-FR');
  const hasClassTomorrow = myBookings.some(b => new Date(b.date).toLocaleDateString('fr-FR') === tomorrowStr);

  const tHomeStr = themeSettings?.tabHome || 'Accueil';
  const tPlanStr = themeSettings?.tabPlanning || 'Planning';
  const tHistStr = themeSettings?.tabHistory || 'Mon Historique';
  const tLogo = themeSettings?.logoUrl || '';

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-4 md:p-8 text-gray-900 pb-32 text-left w-full transition-all duration-300">
      <style dangerouslySetInnerHTML={{__html: `
        :root {
          --app-font: ${themeSettings?.fontFamily || 'ui-sans-serif, system-ui, sans-serif'};
          --app-font-size: ${themeSettings?.fontSize || '16px'};
          --app-card-radius: ${themeSettings?.cardRadius || '16px'};
          --app-btn-radius: ${themeSettings?.btnRadius || '12px'};
        }
        @keyframes flash-vif { 0%, 100% { background-color: #ef4444; color: white; border-color: #fca5a5; transform: scale(1); } 50% { background-color: #f59e0b; color: black; border-color: #fde68a; transform: scale(1.02); } }
        .animate-flash-vif { animation: flash-vif 1.5s infinite; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        body, .min-h-screen { font-family: var(--app-font) !important; font-size: var(--app-font-size) !important; }
        .theme-card { border-radius: var(--app-card-radius) !important; }
        .theme-btn { border-radius: var(--app-btn-radius) !important; font-family: var(--app-font) !important; }
      `}} />
      <div className="w-full max-w-[1500px] mx-auto relative">
        
        {/* BOUÉE DE SAUVETAGE POUR LE SIMULATEUR */}
        {(simulatedRole || simulatedDate || impersonatedUserId) && (
           <button onClick={() => {setSimulatedRole(''); setSimulatedDate(''); setImpersonatedUserId('');}} className="fixed bottom-6 right-6 z-[9999] bg-red-600 hover:bg-red-700 text-white font-black px-6 py-4 rounded-full shadow-2xl flex gap-2 items-center animate-bounce border-4 border-red-200">
              🔴 Quitter Mode Test
           </button>
        )}

        {!devVis.hideHeader && (
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6 py-3 sm:py-4 border-b border-gray-200 relative">
            <div className="flex items-center gap-3 sm:gap-4">
               {tLogo ? <img src={tLogo} className="h-10 sm:h-14 object-contain drop-shadow-sm" alt="Logo"/> : (authUser?.photoURL && <img src={authUser.photoURL} className="w-10 h-10 sm:w-14 sm:h-14 rounded-full border-2 border-amber-200 shadow-sm"/>)}
               <div>
               <h1 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight flex items-center gap-2">
  Bonjour {
    impersonatedUserId 
    ? effectiveUser?.displayName?.split(' ')[0] 
    : authUser?.displayName?.split(' ')[0]
  }
  {impersonatedUserId && (
    <span className="bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded font-black animate-pulse">
      👻 MODE FANTÔME
    </span>
  )}
</h1>
                 <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1 sm:gap-y-2 text-xs sm:text-sm mt-1 sm:mt-2">
                   <button onClick={() => setPaymentInfoOpen(true)} className={`font-bold px-3 py-1 sm:px-4 sm:py-1.5 transition-all border-2 theme-btn ${hasPendingPayments ? 'bg-red-50 text-red-600 border-red-500 animate-pulse' : 'bg-white text-gray-700 border-gray-200'}`}>Moyens de paiement</button>
                   <button onClick={() => setShowProfile(true)} className="text-gray-500 font-medium hover:text-amber-600">Mon Profil</button>
                   <button onClick={() => signOut(auth)} className="text-gray-500 hover:text-red-500">Déconnexion</button>
                 </div>
               </div>
            </div>
            {!devVis.hideIcons && (
              <div className="flex gap-2 sm:gap-3 items-center self-start sm:self-auto flex-wrap w-full sm:w-auto mt-2 sm:mt-0">
                {isAdmin && (
                  <div className="relative">
                    <button onClick={() => setShowNotifications(!showNotifications)} className="p-2 sm:p-3 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 relative theme-btn"><Bell size={18} className="text-gray-600 sm:w-5 sm:h-5"/>{unreadNotifs > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full animate-pulse border-2 border-white"></span>}</button>
                    {showNotifications && (<div className="absolute top-12 sm:top-14 left-0 sm:left-auto sm:right-0 w-[calc(100vw-24px)] sm:w-80 bg-white shadow-2xl border border-gray-200 z-50 overflow-hidden theme-card"><div className="p-3 bg-gray-50 border-b font-bold text-gray-800">Notifications</div><div className="max-h-64 overflow-y-auto">{notifications.length === 0 ? <p className="p-4 text-center text-sm text-gray-500">Aucune notification.</p> : notifications.map(n => (<div key={n.id} onClick={() => markNotifRead(n.id)} className={`p-3 border-b text-sm cursor-pointer ${n.read ? 'text-gray-500 bg-white' : 'text-gray-900 bg-blue-50 font-medium'}`}><p>{n.text}</p><span className="text-[10px] text-gray-400">{new Date(n.date).toLocaleString('fr-FR')}</span></div>))}</div></div>)}
                  </div>
                )}
                
                {(!isAdmin || !hasClassToday) && (
                  <>
                    <a href="https://www.instagram.com/verticali.poledance/" target="_blank" rel="noreferrer" className="p-2 sm:p-3 bg-white border border-gray-200 shadow-sm transition-colors text-pink-600 hover:bg-pink-50 theme-btn" title="Instagram Vertic'Ali"><Instagram size={18} className="sm:w-5 sm:h-5"/></a>
                    <div className="px-3 py-1.5 sm:px-4 sm:py-2.5 bg-white border border-gray-200 shadow-sm text-base sm:text-lg font-black flex gap-1.5 sm:gap-2 items-center cursor-default select-none text-amber-700 theme-btn"><Zap size={18} className="fill-amber-600 sm:w-5 sm:h-5" /> {activeCreds}</div>
                    <button onClick={() => setBoutiqueOpen(true)} className="flex-1 sm:flex-none px-3 py-2 sm:px-4 sm:py-2.5 text-white shadow-md text-xs sm:text-sm font-bold flex justify-center gap-1.5 sm:gap-2 items-center transition-opacity hover:opacity-90 bg-gradient-to-r from-amber-500 to-amber-600 theme-btn"><ShoppingBag size={16} className="sm:w-[18px] sm:h-[18px]" /> Boutique</button>
                  </>
                )}
                {(isAdmin && hasClassToday) && (
                  <button onClick={() => setActiveTab('admin_today')} className="flex-1 sm:flex-none px-4 py-2 sm:py-2.5 shadow-xl text-xs sm:text-sm font-black flex justify-center gap-2 items-center animate-flash-vif theme-btn border-2"><Clock size={18} className="sm:w-5 sm:h-5" /> COURS DU JOUR !</button>
                )}
              </div>
            )}
          </header>
        )}

        {/* BANDEAU J-1 (Si un cours est prévu demain pour l'élève) */}
        {hasClassTomorrow && !isAdmin && (
           <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-4 sm:p-5 rounded-2xl mb-6 shadow-md flex items-center gap-4 theme-card">
              <span className="text-3xl sm:text-4xl">🎒</span>
              <div><p className="font-black text-lg sm:text-xl">Prépare ton sac !</p><p className="text-xs sm:text-sm font-medium opacity-90">Tu as un cours prévu avec nous demain. N'oublie pas ta gourde !</p></div>
           </div>
        )}

        {effectiveUser && !effectiveUser.hasFilledForm && (
          <div className="bg-red-50 border-2 border-red-200 p-4 sm:p-6 mb-6 sm:mb-8 flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6 shadow-sm theme-card">
            <div className="flex items-center gap-3 sm:gap-4 text-red-800 font-medium text-sm sm:text-base"><div className="p-2 sm:p-3 bg-red-100 rounded-full"><AlertTriangle size={24} className="text-red-600 sm:w-7 sm:h-7" /></div><div><p className="font-bold text-base sm:text-lg mb-0.5 sm:mb-1">Dernière étape !</p><p className="text-xs sm:text-sm opacity-90">Pour réserver, tu dois obligatoirement compléter tes coordonnées.</p></div></div>
            <button onClick={() => setShowProfile(true)} className="w-full md:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-black shadow-lg flex justify-center gap-2 theme-btn"><UserPlus size={16} className="sm:w-[18px] sm:h-[18px]"/> Compléter mon profil</button>
          </div>
        )}

        {!devVis.hideTabs && (
          <nav className="flex overflow-x-auto hide-scrollbar gap-1 sm:gap-2 mb-6 sm:mb-8 bg-white p-1.5 shadow-sm border border-gray-100 theme-card">
          <button onClick={() => setActiveTab('accueil')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap transition-colors theme-btn ${activeTab === 'accueil' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><Home size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm">{tHomeStr}</span></button>
          <button onClick={() => setActiveTab('planning')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap transition-colors theme-btn ${activeTab === 'planning' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><Calendar size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm">{tPlanStr}</span></button>
          {!isAdmin && <button onClick={() => setActiveTab('history')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap transition-colors theme-btn ${activeTab === 'history' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><History size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm">{tHistStr}</span></button>}
          
          {isAdmin && (
            <>
              <div className="w-px bg-gray-200 my-1 sm:my-2 mx-1 shrink-0"></div>
              <button onClick={() => setActiveTab('admin_dashboard')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap theme-btn ${activeTab === 'admin_dashboard' ? 'bg-green-100 text-green-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><LayoutDashboard size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm hidden sm:inline">Tableau de Bord</span></button>
              <button onClick={() => setActiveTab('admin_invoices')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap theme-btn ${hasInvoiceAlert ? 'bg-red-100 text-red-600 animate-pulse' : activeTab === 'admin_invoices' ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><FileText size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm">Factures</span></button>
              <button onClick={() => setActiveTab('admin_students')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap theme-btn ${activeTab === 'admin_students' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><Users size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm hidden sm:inline">Élèves</span></button>
              <button onClick={() => setActiveTab('admin_past')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap theme-btn ${activeTab === 'admin_past' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><Archive size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm hidden lg:inline">Archives</span></button>
              <button onClick={() => setActiveTab('admin_today')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap theme-btn ${activeTab === 'admin_today' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><Clock size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm">Cours du jour</span></button>
              <button onClick={() => setActiveTab('admin_settings')} className={`flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap theme-btn ${activeTab === 'admin_settings' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}><Settings size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm hidden lg:inline">Réglages</span></button>
            </>
          )}
          {isRealDevAdmin && (
             <button onClick={() => setActiveTab('dev_admin')} className="flex items-center gap-1.5 px-3 sm:px-6 py-2 sm:py-3 font-bold whitespace-nowrap ml-auto transition-colors" style={activeTab === 'dev_admin' ? {backgroundColor: '#2563eb', color: '#ffffff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'} : {backgroundColor: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe', borderRadius: '12px'}}><Code size={16} className="sm:w-[18px] sm:h-[18px]"/><span className="text-xs sm:text-sm">Dev</span></button>
          )}
        </nav>
        )}

        {activeTab === 'accueil' && (
          <div className="bg-white shadow-sm border border-gray-100 overflow-hidden flex flex-col md:flex-row mb-8 theme-card">
            {globalSettings.welcomeImageUrl && (<div style={{ width: window.innerWidth > 768 ? `${globalSettings.welcomeImageSize || 50}%` : '100%' }} className="min-h-[300px] bg-gray-50 border-b md:border-b-0 md:border-r border-gray-100"><img src={globalSettings.welcomeImageUrl} alt="Accueil" className="w-full h-full object-cover" /></div>)}
            <div style={{ width: (globalSettings.welcomeImageUrl && window.innerWidth > 768) ? `${100 - (globalSettings.welcomeImageSize || 50)}%` : '100%' }} className="p-8 md:p-12 flex flex-col justify-center"><h2 className="text-3xl font-black text-gray-900 mb-6">Bienvenue chez Vertic'Ali !</h2><div className="text-gray-600 whitespace-pre-wrap leading-relaxed mb-8" style={{ fontSize: `${globalSettings.welcomeTextSize || 18}px` }}>{globalSettings.welcomeText || "Bienvenue sur votre espace de réservation. Consultez le planning pour réserver vos prochaines séances !"}</div><button onClick={() => setActiveTab('planning')} className="px-8 py-4 text-white font-bold shadow-lg w-fit flex items-center gap-2 transition-colors hover:opacity-90 bg-gray-900 theme-btn"><Calendar size={20}/> Voir le planning</button></div>
          </div>
        )}

        {activeTab === 'planning' && (
          <div>
            {isAdmin && <AdminClassForm onAdd={fetchAllData} locations={locations} templates={templates} editClassData={editingClass} onCancelEdit={() => setEditingClass(null)} />}
            {classes.length === 0 ? ( <div className="bg-white p-10 text-center text-gray-400 theme-card">Aucun cours à venir.</div> ) : (<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 items-start">{classes.map(c => <ClassCard key={c.id} info={c} onDelete={async(id:string)=>{await deleteDoc(doc(db,"classes",id)); fetchAllData()}} onEditClick={setEditingClass} onBookClick={initiateBooking} onCancelClick={handleCancel} processingId={processingId} userProfile={effectiveUser} isBooked={c.attendeeIds?.includes(effectiveUser?.id || '')} onRefresh={fetchAllData} />)}</div>)}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white shadow-sm border border-gray-100 p-6 max-w-3xl text-left theme-card"><h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><History size={24} className="text-amber-600"/> Mon Historique & Achats</h2>
            {userTimeline.length === 0 ? <p className="text-gray-500">Aucun historique pour le moment.</p> : (
              <div className="space-y-4">
                {userTimeline.map((item, idx) => {
                  if (item.type === 'BOOKING') {
                    const b = item.data as BookingInfo;
                    return (<div key={`hist-b-${b.id}-${idx}`} className="flex justify-between items-center p-4 border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow theme-card"><div><div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-black px-2 py-0.5 bg-blue-100 text-blue-700 theme-btn">COURS</span><h3 className="font-bold text-gray-800">{b.classTitle}</h3></div><p className="text-sm text-gray-500 capitalize">{new Date(b.date).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'})}</p></div><div className="text-right flex flex-col items-end gap-2"><div className="flex items-center gap-2"><span className="text-xs font-bold text-gray-500">Via {b.paymentMethod}</span><span className={`text-xs font-bold px-2 py-1 theme-btn ${b.paymentStatus === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{b.paymentStatus === 'PAID' ? 'Payé' : 'À régler'}</span></div>{b.paymentStatus === 'PAID' && b.paymentMethod !== 'CREDIT' && (<button onClick={async () => { await generateInvoicePDF(b, effectiveUser, { title: b.classTitle, startAt: new Date(b.date), price: b.price }); await updateDoc(doc(db, "bookings", b.id), { invoiceDownloaded: true }); }} className="flex items-center gap-1 text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 hover:bg-indigo-100 transition-colors theme-btn"><Download size={14}/> Ma facture</button>)}</div></div>);
                  } else {
                    const p = item.data as CreditPurchase; const expiryDate = new Date(p.date); expiryDate.setDate(expiryDate.getDate() + p.validityDays);
                    return (<div key={`hist-p-${p.id}-${idx}`} className="flex justify-between items-center p-4 border border-amber-200 bg-amber-50 shadow-sm hover:shadow-md transition-shadow theme-card"><div><div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-black px-2 py-0.5 bg-amber-200 text-amber-900 theme-btn">BOUTIQUE</span><h3 className="font-bold text-gray-800">{p.packName}</h3></div><p className="text-sm text-gray-600">Acheté le {new Date(p.date).toLocaleDateString('fr-FR')}</p><p className="text-xs font-medium mt-0.5 text-amber-700">Valide jusqu'au {expiryDate.toLocaleDateString('fr-FR')}</p></div><div className="text-right flex flex-col items-end gap-2"><div className="flex items-center gap-2"><span className="text-sm font-black text-amber-600">{p.price} €</span><span className={`text-[10px] font-bold px-2 py-1 theme-btn ${p.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{p.status === 'PAID' ? 'Payé' : 'À régler'}</span></div>{p.status === 'PAID' && <button onClick={() => generatePackInvoicePDF(p, effectiveUser)} className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 hover:bg-indigo-100 transition-colors theme-btn"><Download size={12}/> Facture PDF</button>}</div></div>);
                  }
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'admin_today' && isAdmin && <AdminTodayTab classes={[...classes, ...pastClasses]} users={devUsers} today={todayDate} bookings={allBookings} />}
        {activeTab === 'admin_dashboard' && isAdmin && <AdminDashboardTab reminderDays={globalSettings.reminderDays} today={todayDate} />}
        {activeTab === 'admin_invoices' && isAdmin && <AdminInvoicesTab today={todayDate} />}
        {activeTab === 'admin_students' && isAdmin && <AdminStudentsTab onImpersonate={(id) => {setImpersonatedUserId(id); setActiveTab('planning');}} />}
        {activeTab === 'admin_past' && isAdmin && (<div><h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><Archive className="text-gray-600"/> Archives</h2><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 opacity-75 items-start">{pastClasses.map(c => <ClassCard key={c.id} info={c} onDelete={async(id:string)=>{await deleteDoc(doc(db,"classes",id)); fetchAllData()}} processingId={null} userProfile={effectiveUser} isBooked={false} onBookClick={()=>{}} onCancelClick={()=>{}} onRefresh={fetchAllData} />)}</div></div>)}
        {activeTab === 'admin_settings' && isAdmin && <AdminSettingsTab locations={locations} templates={templates} globalSettings={globalSettings} creditPacks={creditPacks} />}
        {activeTab === 'dev_admin' && isRealDevAdmin && <DevAdminTab themeSettings={themeSettings} users={devUsers} devVis={devVis} setDevVis={setDevVis} simRole={simulatedRole} setSimRole={setSimulatedRole} simDate={simulatedDate} setSimDate={setSimulatedDate} />}
      </div>

      {showProfile && effectiveUser && <UserProfileForm user={effectiveUser} onClose={() => setShowProfile(false)}/>}
      <PaymentModal isOpen={paymentModal.isOpen} onClose={() => setPaymentModal({isOpen:false, classId:null})} onConfirm={confirmBooking} userCredits={activeCreds}/>
      <PaymentInfoModal isOpen={isPaymentInfoOpen} onClose={() => setPaymentInfoOpen(false)} />
      {effectiveUser && <BoutiqueModal isOpen={isBoutiqueOpen} onClose={() => setBoutiqueOpen(false)} user={effectiveUser} packs={creditPacks} />}
      
      {effectiveUser?.pendingPopup && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4 text-center">
           <div className="bg-white p-8 max-w-md w-full shadow-2xl relative animate-in fade-in zoom-in duration-300 theme-card">
             <Bell className="mx-auto text-amber-500 mb-4 animate-bounce" size={48}/>
             <h3 className="text-2xl font-black text-gray-900 mb-4">Nouveau Message</h3>
             <p className="text-gray-600 mb-8 whitespace-pre-wrap text-lg font-medium">{effectiveUser.pendingPopup}</p>
             <button onClick={closeUserPopup} className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-lg transition-colors text-lg theme-btn">J'ai compris</button>
           </div>
        </div>
      )}

      {bookingSuccessData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 text-left"><div className="bg-white p-6 max-w-md w-full shadow-2xl relative animate-in fade-in zoom-in duration-200 theme-card"><h3 className="text-2xl font-black text-gray-800 mb-2 flex items-center gap-2"><CheckCircle className="text-green-500" size={28}/> Réservé ! 🎉</h3><p className="text-gray-600 mb-4 font-medium">Ta place est confirmée pour le cours.</p><div className="bg-amber-50 p-4 mb-4 border border-amber-100 theme-card"><h4 className="font-bold text-amber-900 mb-2 flex items-center gap-2"><ShoppingBag size={18}/> Matériel</h4><ul className="text-sm text-amber-800 space-y-1 mb-4 list-disc pl-5"><li>Short court + brassière</li><li>Tapis de yoga (si tu en possèdes un)</li><li>Gourde d'eau</li></ul><h4 className="font-bold text-amber-900 mb-2 flex items-center gap-2"><AlertTriangle size={18}/> À noter</h4><ul className="text-sm text-amber-800 space-y-1 list-none"><li className="flex gap-2"><XCircle size={16} className="text-red-500 shrink-0"/> Retire tes bijoux.</li><li className="flex gap-2"><XCircle size={16} className="text-red-500 shrink-0"/> Pas de crème/huile sur le corps !</li></ul></div><div className="flex flex-col gap-3"><a href={generateGoogleCalendarLink(bookingSuccessData.title, bookingSuccessData.startAt, bookingSuccessData.endAt, bookingSuccessData.locationAddress || bookingSuccessData.location, bookingSuccessData.description || '')} target="_blank" rel="noreferrer" onClick={() => setBookingSuccessData(null)} className="w-full py-3 bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 flex justify-center gap-2 theme-btn"><CalendarPlus size={20}/> Ajouter à mon Agenda</a><button onClick={() => setBookingSuccessData(null)} className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-bold transition-opacity theme-btn">J'ai compris !</button></div></div></div>
      )}
    </div>
  );
}
