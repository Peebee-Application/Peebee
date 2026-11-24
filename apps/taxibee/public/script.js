/* =========================================================
   Taxibee Passenger App — Presentation Prototype
   All state is intentionally in-memory and resets on refresh.
   ========================================================= */

'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(' ');
  if (parts.length < 2) return 0;
  const [time, modifier] = parts;
  let [hours, minutes] = time.split(':').map(Number);
  if (hours === 12) {
    hours = 0;
  }
  if (modifier === 'PM') {
    hours += 12;
  }
  return hours * 60 + minutes;
}

function minutesToTimeStr(m) {
  const totalMins = m % 1440;
  let hours = Math.floor(totalMins / 60);
  const minutes = totalMins % 60;
  const modifier = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, '0')} ${modifier}`;
}

function getAvailableTrips() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let startSlot = Math.ceil(currentMinutes / 30) * 30;
  const trips = [];
  const routeCards = appData.routeCards || [];
  
  const activeDriverKeys = [
    'moses mukasa',
    'isaac muwonge',
    'john ssekabira',
    'david okello',
    'peter semwanga',
    'arthur ssewankambo',
    'hassan kato'
  ];
  const plates = ['UBM 245K', 'UBP 318F', 'UBN 742D', 'UBQ 915A', 'UBR 104C', 'UBS 882E', 'UBT 509M', 'UBU 394M', 'UBV 194P', 'UBW 821Z'];
  const vehicleTypes = ['Highroof (18)', 'Commuter (14)', 'Highroof (18)', 'Commuter (14)', 'Commuter (14)', 'Highroof (18)', 'Executive Coaster (30)'];
  
  for (let i = 0; i < 12; i++) {
    const slot = startSlot + i * 30;
    const minsLeft = slot - currentMinutes;
    
    let countdown = '';
    if (minsLeft < 60) {
      countdown = `${minsLeft} mins`;
    } else {
      const hrs = Math.floor(minsLeft / 60);
      const mins = minsLeft % 60;
      countdown = `${hrs}h ${mins}m`;
    }

    const departTime = minutesToTimeStr(slot);
    const arriveTime = minutesToTimeStr(slot + 65);
    
    const rc = routeCards[i % routeCards.length] || { key: 'kajansi', stageA: 'Entebbe Bus Park', stageB: 'Kampala Railway Stage', price: 'UGX 5,000', via: 'Via Kajansi', imageB: 'assets/kampala.jpg' };
    
    const driverKey = activeDriverKeys[i % activeDriverKeys.length];
    const driver = (driversData && driversData[driverKey]) || driversData['moses mukasa'];
    
    let driverName = driver.name;
    let plate = driver.plate || plates[i % plates.length];
    let driverRating = driver.rating;
    let driverPhone = '+256 774 123 ' + String(100 + i);
    let vehicleName = driver.vehicle || vehicleTypes[i % vehicleTypes.length];
    let image = getDriverHeroImage(driverName);

    const seats = 3 + (i * 7 + 13) % 10;
    const status = seats <= 3 ? 'Almost full' : 'Available';

    trips.push({
      id: `dynamic-t${i}`,
      depart: departTime,
      arrive: arriveTime,
      seats: seats,
      status: status,
      vehicle: vehicleName,
      plate: plate,
      duration: '1 hr 05 min',
      fare: parseInt(rc.price.replace(/[^\d]/g, '')) || 5000,
      traffic: i % 3 === 0 ? 'Light' : i % 3 === 1 ? 'Moderate' : 'Heavy',
      boarding: rc.stageA,
      destination: rc.stageB,
      currentStage: rc.stageA,
      comingFrom: rc.stageB,
      headingTo: rc.stageA,
      markerIndex: 0,
      vansAtStage: 4,
      vansApproaching: 1,
      driverName: driverName,
      driverPhone: driverPhone,
      driverRating: driverRating,
      countdown: countdown,
      img: image,
      destThumb: rc.imageB,
      price: rc.price,
      via: rc.via
    });
  }
  return trips;
}

const appData = {
  passenger: {
    name: 'Christo I.',
    phone: '+256 772 345 678',
    email: 'christo.i@example.com',
    preferredRoute: 'Entebbe Bus Park → Kampala Railway Stage'
  },
  routes: ['Entebbe Bus Park', 'Kitooro', 'Abayita Ababiri', 'Kajjansi', 'Clock Tower', 'Kampala Railway Stage', 'Nambole', 'Mpigi', 'Buwama', 'Masaka', 'Lyantonde', 'Mbarara'],
  routeCards: [
    { key: 'kajansi', cityA: 'Entebbe', cityB: 'Kampala City', stageA: 'Entebbe Bus Park', stageB: 'Kampala Railway Stage', via: 'Via Kajansi', price: 'UGX 5,000', imageA: 'assets/entebbe.jpg', imageB: 'assets/kampala.jpg', corridor: 'Entebbe • Kitooro • Abayita Ababiri • Kajjansi • Clock Tower • Kampala City', coordA: [0.0618, 32.4742], coordB: [0.3136, 32.5811] },
    { key: 'busega', cityA: 'Entebbe', cityB: 'Kampala City', stageA: 'Entebbe Bus Park', stageB: 'Kampala Railway Stage', via: 'Via Busega', price: 'UGX 5,000', imageA: 'assets/entebbe.jpg', imageB: 'assets/kampala.jpg', corridor: 'Entebbe • Kitooro • Abayita Ababiri • Busega • Clock Tower • Kampala City', coordA: [0.0618, 32.4742], coordB: [0.3136, 32.5811] },
    { key: 'nambole', cityA: 'Entebbe', cityB: 'Nambole', stageA: 'Entebbe Bus Park', stageB: 'Nambole', via: 'Via Kajansi', price: 'UGX 7,000', imageA: 'assets/entebbe.jpg', imageB: 'assets/nambole.jpg', corridor: 'Entebbe • Kitooro • Abayita Ababiri • Kajjansi • Nambole', coordA: [0.0618, 32.4742], coordB: [0.3475, 32.6281] },
    { key: 'masaka', cityA: 'Entebbe', cityB: 'Masaka', stageA: 'Entebbe Bus Park', stageB: 'Masaka', via: 'Via Masaka Road', price: 'UGX 20,000', imageA: 'assets/entebbe.jpg', imageB: 'assets/masaka.jpg', corridor: 'Entebbe • Kajjansi • Mpigi • Buwama • Masaka', coordA: [0.0618, 32.4742], coordB: [-0.3375, 31.7350] },
    { key: 'lyantonde', cityA: 'Entebbe', cityB: 'Lyantonde', stageA: 'Entebbe Bus Park', stageB: 'Lyantonde', via: 'Via Masaka Road', price: 'UGX 25,000', imageA: 'assets/entebbe.jpg', imageB: 'assets/lyantonde.jpg', corridor: 'Entebbe • Kajjansi • Mpigi • Masaka • Lyantonde', coordA: [0.0618, 32.4742], coordB: [-0.4047, 31.1597] },
    { key: 'mbarara', cityA: 'Entebbe', cityB: 'Mbarara', stageA: 'Entebbe Bus Park', stageB: 'Mbarara', via: 'Via Masaka Road', price: 'UGX 30,000', imageA: 'assets/entebbe.jpg', imageB: 'assets/mbarara.jpg', corridor: 'Entebbe • Kajjansi • Mpigi • Masaka • Lyantonde • Mbarara', coordA: [0.0618, 32.4742], coordB: [-0.6071, 30.6545] }
  ],
  get trips() {
    return getAvailableTrips();
  },
  luggage: [
    { id: 'personal', icon: 'briefcase-business', name: 'Small personal item', desc: 'Handbag or compact backpack', guide: 'Fits on your lap', price: 0 },
    { id: 'standard', icon: 'luggage', name: 'Standard bag', desc: 'Regular travel suitcase', guide: 'Up to 15 kg', price: 2000 },
    { id: 'large', icon: 'package-open', name: 'Large bag', desc: 'Large suitcase or sack', guide: 'Up to 25 kg', price: 4000 },
    { id: 'excess', icon: 'boxes', name: 'Excess luggage', desc: 'Additional bulky luggage', guide: 'Stage approval required', price: 6000 },
    { id: 'fragile', icon: 'glass-water', name: 'Fragile item', desc: 'Careful handling requested', guide: 'Must be securely packed', price: 7000 },
    { id: 'commercial', icon: 'store', name: 'Commercial luggage', desc: 'Business or resale goods', guide: 'Price assessed at stage', price: null }
  ],
  transactions: [
    { type: 'deposit', title: 'Wallet deposit', date: 'Today, 7:42 AM', amount: 20000, direction: 'in', icon: 'arrow-down-left' },
    { type: 'trip', title: 'Entebbe to Kampala ticket', date: 'Yesterday, 8:12 AM', amount: 5000, direction: 'out', icon: 'ticket' },
    { type: 'trip', title: 'Return-ticket package', date: '15 Jul, 6:40 PM', amount: 9000, direction: 'out', icon: 'refresh-cw' },
    { type: 'parcel', title: 'Parcel delivery', date: '14 Jul, 10:25 AM', amount: 7500, direction: 'out', icon: 'package' },
    { type: 'promotion', title: 'Promotional credit', date: '12 Jul, 9:00 AM', amount: 2000, direction: 'in', icon: 'gift' },
    { type: 'luggage', title: 'Luggage payment', date: '10 Jul, 2:15 PM', amount: 4000, direction: 'out', icon: 'luggage' },
    { type: 'refund', title: 'Pending travel refund', date: '8 Jul, 4:34 PM', amount: 5000, direction: 'in', icon: 'rotate-ccw' }
  ],
  notifications: [
    { id: 1, category: 'Travels', icon: 'bus-front', title: 'Your vehicle is ready for boarding.', body: 'UBM 245K is boarding at Entebbe Main Stage. Please arrive by 8:15 AM.', time: '2 min ago', unread: true },
    { id: 2, category: 'Travels', icon: 'calendar-clock', title: 'Your return ticket expires in three days.', body: 'Book your Kampala to Entebbe return before 21 July 2026.', time: '1 hr ago', unread: true },
    { id: 3, category: 'Parcels', icon: 'package-check', title: 'Your parcel has arrived in Kampala.', body: 'Parcel #964201832-DL will soon be ready for collection.', time: '2 hrs ago', unread: true },
    { id: 4, category: 'Payments', icon: 'wallet-cards', title: 'UGX 20,000 was added to your wallet.', body: 'Your demonstration wallet balance is now UGX 32,500.', time: 'Yesterday', unread: true },
    { id: 5, category: 'Alerts', icon: 'triangle-alert', title: 'Traffic is heavier than usual.', body: 'Allow approximately 15 additional minutes on the Kampala route.', time: 'Yesterday', unread: true },
    { id: 6, category: 'Parcels', icon: 'luggage', title: 'Your luggage reference has been confirmed.', body: 'Luggage tag LUG-1842 is linked to ticket FET-884210.', time: '15 Jul', unread: false }
  ],
  specialHireVehicles: [
    { id: 'sedan', name: 'Saloon Car / Sedan (4 Seats)', seats: 4, dailyRate: 100000, dayRate: 100000, desc: 'Perfect for solo business travelers, couples, or small private trips.', img: 'assets/taxibee-sedan-branded.png' },
    { id: 'noah', name: 'Toyota Noah (7 Seats)', seats: 7, dailyRate: 150000, dayRate: 150000, desc: 'Versatile and spacious mid-size vehicle for family or small groups.', img: 'assets/taxibee-noah-branded.png' },
    { id: 'minivan', name: 'Alphard / Multi-Seater (10 Seats)', seats: 10, dailyRate: 200000, dayRate: 200000, desc: 'Premium executive multi-seater for comfort and style.', img: 'assets/taxibee-minivan-branded.png' },
    { id: 'commuter', name: 'Commuter (14 Seats)', seats: 14, dailyRate: 250000, dayRate: 250000, desc: 'Standard group commuter for events and tours.', img: 'assets/taxibee-van.png' },
    { id: 'highroof', name: 'Highroof (18 Seats)', seats: 18, dailyRate: 300000, dayRate: 300000, desc: 'Spacious high-roof van with extra luggage room.', img: 'assets/taxibee-van.png' },
    { id: 'coaster', name: 'Executive Coaster (30 Seats)', seats: 30, dailyRate: 450000, dayRate: 450000, desc: 'Full size executive bus for large groups.', img: 'assets/taxibee-coaster-branded.png' }
  ]
};

const driversData = {
  'isaac muwonge': {
    name: 'Isaac Muwonge',
    avatar: 'assets/driver_1-branded.png',
    hero: 'assets/driver_1_hero-branded.png',
    role: 'Taxibee Driver',
    rating: '4.95',
    routes: '1,420',
    km: '58,400',
    associationTime: '2 years 4 months',
    bio: 'Friendly, professional driver from Uganda with over 2 years driving with the Association. Highly rated for punctuality, route knowledge along the Entebbe-Kampala Expressway, and safe handling of parcels.',
    vehicle: 'Commuter (14)',
    plate: 'UBM 245K',
    color: 'White & Blue',
    status: 'driving', // active on road
    compliments: ['Safe Driver', 'Super Friendly', 'Great Navigator', 'Punctual'],
    reviews: [
      { author: 'Sharon A.', rating: 5, date: '3 days ago', comment: 'Smooth ride on the expressway. Very punctual!' },
      { author: 'Ronald K.', rating: 5, date: '1 week ago', comment: 'He helped load my heavy suitcases. Very kind driver.' }
    ]
  },
  'moses mukasa': {
    name: 'Moses Mukasa',
    avatar: 'assets/driver_2-branded.png',
    hero: 'assets/driver_2_hero-branded.png',
    role: 'Taxibee Driver',
    rating: '4.90',
    routes: '1,280',
    km: '48,200',
    associationTime: '2 years 0 months',
    bio: 'Experienced passenger driver on the Kampala-Entebbe corridor. Committed to passenger safety and comfort.',
    vehicle: 'Highroof (18)',
    plate: 'UBM 245K',
    color: 'White & Blue',
    status: 'idle',
    compliments: ['Gentle Driver', 'Helpful', 'Polite'],
    reviews: [
      { author: 'Andrew O.', rating: 5, date: '2 days ago', comment: 'Friendly and keeps the vehicle well ventilated.' },
      { author: 'Jack B.', rating: 4, date: '5 days ago', comment: 'Safe driving but started 5 mins late.' }
    ]
  },
  'john ssekabira': {
    name: 'John Ssekabira',
    avatar: 'assets/driver_3-branded.png',
    hero: 'assets/driver_3_hero-branded.png',
    role: 'Taxibee Driver',
    rating: '4.80',
    routes: '980',
    km: '36,500',
    associationTime: '1 year 6 months',
    bio: 'Reliable and friendly driver. Enjoys interacting with commuters and keeping a clean vehicle.',
    vehicle: 'Highroof (18)',
    plate: 'UBP 318F',
    color: 'White & Blue',
    status: 'idle',
    compliments: ['Great Music', 'Clean Vehicle', 'Friendly'],
    reviews: [
      { author: 'Maria N.', rating: 5, date: 'Yesterday', comment: 'Great playlist playing during the travel, loved the music!' },
      { author: 'Brian L.', rating: 5, date: '4 days ago', comment: 'Very clean seats and polite driver.' }
    ]
  },
  'david okello': {
    name: 'David Okello',
    avatar: 'assets/driver_4-branded.png',
    hero: 'assets/driver_4_hero-branded.png',
    role: 'Taxibee Driver',
    rating: '4.70',
    routes: '760',
    km: '28,100',
    associationTime: '1 year 0 months',
    bio: 'Punctual and focused driver with great knowledge of traffic patterns and alternative routes.',
    vehicle: 'Commuter (14)',
    plate: 'UBN 742D',
    color: 'White & Blue',
    status: 'idle',
    compliments: ['Great Navigator', 'Punctual'],
    reviews: [
      { author: 'Kenneth M.', rating: 5, date: '3 days ago', comment: 'Avoided the traffic jam near Kajjansi smartly. Good job.' },
      { author: 'Diana K.', rating: 4, date: '1 week ago', comment: 'A bit fast but overall safe.' }
    ]
  },
  'peter semwanga': {
    name: 'Peter Semwanga',
    avatar: 'assets/driver_5-branded.png',
    hero: 'assets/driver_5_hero-branded.png',
    role: 'Taxibee Driver',
    rating: '4.90',
    routes: '1,510',
    km: '61,200',
    associationTime: '3 years 0 months',
    bio: 'One of the association\'s most senior drivers. Extremely safe records and highly commended by regulars.',
    vehicle: 'Commuter (14)',
    plate: 'UBQ 915A',
    color: 'White & Blue',
    status: 'idle',
    compliments: ['Safe Driver', 'Polite', 'Experienced'],
    reviews: [
      { author: 'Florence A.', rating: 5, date: '2 days ago', comment: 'Smooth drive and professional crew.' },
      { author: 'Emmanuel T.', rating: 5, date: '6 days ago', comment: 'Very experienced driver. Felt safe the whole travel.' }
    ]
  },
  'arthur ssewankambo': {
    name: 'Arthur Ssewankambo',
    avatar: 'assets/driver_6-branded.png',
    hero: 'assets/driver_6_hero-branded.png',
    role: 'Taxibee Driver',
    rating: '4.60',
    routes: '540',
    km: '21,000',
    associationTime: '0 years 9 months',
    bio: 'Courteous driver specializing in morning commutes. Always ready to assist passengers with luggage.',
    vehicle: 'Highroof (18)',
    plate: 'UBR 104C',
    color: 'White & Blue',
    status: 'idle',
    compliments: ['Helpful', 'Polite'],
    reviews: [
      { author: 'Josephine N.', rating: 5, date: '4 days ago', comment: 'Helped me lift my heavy box. Very polite!' },
      { author: 'Peter K.', rating: 4, date: '1 week ago', comment: 'Standard drive, arrived on time.' }
    ]
  },
  'hassan kato': {
    name: 'Hassan Kato',
    avatar: 'assets/driver_7-branded.png',
    hero: 'assets/driver_7_hero-branded.png',
    role: 'Taxibee Driver',
    rating: '4.92',
    routes: '1,150',
    km: '42,600',
    associationTime: '2 years 1 month',
    bio: 'Dedicated express driver along the Kampala-Entebbe corridor. Highly praised for punctuality, smooth driving, and courteous service.',
    vehicle: 'Alphard / Multi-Seater (10)',
    plate: 'UBT 509M',
    color: 'Silver & Blue',
    status: 'idle',
    compliments: ['Safe Driver', 'Super Friendly', 'Punctual'],
    reviews: [
      { author: 'Samson B.', rating: 5, date: '1 day ago', comment: 'Punctual and very smooth driving on the expressway.' }
    ]
  },
  'daniel': {
    name: 'Daniel',
    avatar: '',
    role: 'Taxibee Driver',
    rating: '4.85',
    routes: '1,120',
    km: '44,600',
    associationTime: '1 year 9 months',
    bio: 'Professional driver dedicated to passenger safety, luggage care, and smooth journeys.',
    vehicle: 'Commuter (14)',
    plate: 'UBM 245K',
    color: 'White & Blue',
    status: 'idle',
    compliments: ['Safe Driver', 'Helpful with Luggage'],
    reviews: [
      { author: 'Robert S.', rating: 5, date: '2 days ago', comment: 'Excellent service, very smooth ride.' },
      { author: 'Clara W.', rating: 5, date: '5 days ago', comment: 'Professional and highly recommended driver.' }
    ]
  }
};

const state = {
  selectedRoute: null,
  viewingDriverName: 'isaac muwonge',
  bookingStep: 1,
  dateSelectionMode: 'today',
  onboardingIndex: 0,
  authView: 'signin',
  screen: 'home',
  history: [],
  activeTrip: appData.trips[0],
  tripType: 'oneway',
  ticketType: 'oneway',
  returnMode: 'open',
  returnDate: '2026-07-21',
  bookingDate: '2026-07-18',
  searchFrom: 'Entebbe Bus Park',
  searchTo: 'Kampala Railway Stage',
  dropOffLocation: '',
  customDropOff: '',
  searchPeriod: '',
  userName: 'Christo I.',
  userPhone: '+256 772 345 678',
  userEmail: 'christo.i@example.com',
  userAvatar: 'assets/christo-avatar.jpg',
  emergencyContact: '+256 700 123 456',
  bookingOption: '',
  assistance: 'None required',
  passengerCount: 1,
  childCount: 0,
  reservedChildSeatsCount: 0,
  isBookingForSomeoneElse: false,
  otherTravelerName: '',
  otherTravelerPhone: '',
  passengerDetails: [{ name: 'Christo I.', phone: '+256 772 345 678', category: 'Adult passenger', assistance: 'None required', emergency: '+256 700 123 456' }],
  capacityMode: 'capacity',
  selectedSeats: [],
  luggageQuantities: { personal: 1, standard: 0, large: 0, excess: 0, fragile: 0, commercial: 0 },
  walletBalance: 32500,
  walletDepositAmount: 20000,
  paymentMethod: 'wallet',
  paymentDemoState: 'idle',
  voucherApplied: false,
  ticketStatus: 'active',
  tripTab: 'upcoming',
  trackingTab: 'travels',
  walletFilter: 'all',
  notificationFilter: 'all',
  parcelStep: 1,
  parcelCategory: 'Small box',
  parcelDelivery: 'Standard Stage-to-Stage',
  parcelPaymentMethod: 'wallet',
  parcelPaymentDemoState: 'idle',
  parcel: {
    senderName: 'Christo I.',
    senderPhone: '+256 772 345 678',
    recipientName: 'Joan Nankya',
    recipientPhone: '+256 772 987 654',
    origin: 'Entebbe',
    pickupLocation: '',
    customPickup: '',
    destination: 'Kampala',
    dropoffLocation: '',
    customDropoff: '',
    description: 'Demonstration parcel',
    weight: '520 g',
    quantity: '1',
    declaredValue: 'UGX 50,000',
    fragile: 'No',
    instructions: 'Deliver to Joan Nankya at Kampala Railway Stage.',
    dropoff: 'Today · 8:00–9:00 AM',
    departure: 'Next available vehicle'
  },
  parcelTrackingState: 'intransit',
  supportSubmitted: false,
  language: 'English',
  unreadNotifications: 5,
  routeProgress: 68,
  connected: true,
  routeFlips: {},
  detectedOriginCity: 'Entebbe',
  specialHire: {
    step: 1,
    vehicleType: 'highroof',
    destinationType: 'standard',
    standardRoute: 'kajansi',
    customDestination: '',
    date: '2026-07-21',
    durationDays: 1,
    driverType: 'standard',
    hireType: 'individual',
    companyName: '',
    companyTaxId: '',
    paymentMethod: 'wallet',
    paymentDemoState: 'idle'
  },
  transparentVehicles: {}
};

// ==========================================================================
// Platform Authentication Gate & Persistent Login Logs System
// ==========================================================================
const AUTH_STORAGE_KEY = 'taxibee_auth_session';
const LOGIN_LOGS_KEY = 'taxibee_login_logs';
const USERS_STORAGE_KEY = 'taxibee_users';

// Authentication and customer data are supplied by live.js via the shared Peebee API.
function getAuthSession() { return window.Taxibee?.session() || null; }
function isPlatformAuthenticated() { return window.Taxibee?.canBrowse?.() || window.Taxibee?.authenticated() || false; }
function updateLoginLogBadges() {}
function getLoginLogs() { return []; }
function formatRelativeTime() { return ""; }
function recordLoginLog() {}
function exportLoginLogsJSON() {}
function exportLoginLogsCSV() {}
function clearLoginLogs() {}
function simulateTestLoginEvent() {}
function handleLogSearch() {}
function handlePlatformLogin(e) { e?.preventDefault(); return window.Taxibee.login(); }
function handlePlatformRegister(e) { e?.preventDefault(); return window.Taxibee.register(); }

const navItems = [
  ['home', 'Home', 'house'],
  ['book', 'Book a Travel', 'ticket-plus'],
  ['special-hire', 'Special Hire', 'bus'],
  ['tracking', 'Tracking', 'navigation'],
  ['trips', 'My Travels', 'route'],
  ['wallet', 'Wallet', 'wallet-cards'],
  ['parcel', 'Parcels', 'package-plus'],
  ['offers', 'Offers', 'badge-percent'],
  ['support', 'Help and Support', 'life-buoy'],
  ['about', 'About Taxibee', 'info'],
  ['profile', 'My Account', 'user']
];

const screenTitles = {
  home: 'Home', book: 'Book a Travel', 'special-hire': 'Special Hire', 'trip-details': 'Travel Details', passengers: 'Passengers & Capacity', returns: 'Return Tickets', luggage: 'Luggage', checkout: 'Checkout', success: 'Booking Confirmed', ticket: 'Digital Ticket', trips: 'My Travels', live: 'Live Travel', wallet: 'Taxibee Wallet', parcel: 'Send a Parcel', 'parcel-receipt': 'Parcel Receipt', 'trackparcel-list': 'Track Parcel', trackparcel: 'Live tracking', 'parcel-status': '#964201832-DL', 'driver-profile': 'Driver profile', 'driver-chat': 'Chat with Driver', 'driver-call': 'Call Driver', offers: 'Offers', notifications: 'Notifications', support: 'Help and Support', profile: 'Profile & Settings', about: 'About Taxibee', tracking: 'Tracking', 'search-results': 'Search Results', 'available-vans': 'Available Departures', 'login-logs': 'Access & Login Logs'
};

const onboardingSlides = [
  {
    title: 'Your Journey<br>Starts Here',
    message: 'Book your Taxibee travel, choose your preferred departure, and secure your seat in seconds.'
  },
  {
    title: 'Pay Easily.<br>Travel for Less.',
    message: 'Use your Taxibee Wallet, buy discounted return tickets, and keep all your travel payments and tickets in one place.'
  },
  {
    title: 'More Than<br>Passenger Travel',
    message: 'Send parcels, register your luggage, and follow every journey from dispatch to safe collection.'
  }
];

function formatUGX(value) {
  if (value === null) return 'Assessed at stage';
  return `UGX ${Number(value).toLocaleString('en-US')}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function optionMarkup(value, selectedValue, label = value) {
  return `<option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function passengerMixLabel() {
  const adults = `${state.passengerCount} adult${state.passengerCount === 1 ? '' : 's'}`;
  const children = state.childCount ? `, ${state.childCount} child${state.childCount === 1 ? '' : 'ren'}` : '';
  let seatsInfo = '';
  if (state.childCount) {
    if (state.reservedChildSeatsCount === 0) {
      seatsInfo = ' (on lap)';
    } else if (state.reservedChildSeatsCount === state.childCount) {
      seatsInfo = ' (seats reserved)';
    } else {
      seatsInfo = ` (${state.reservedChildSeatsCount} seat${state.reservedChildSeatsCount === 1 ? '' : 's'} reserved)`;
    }
  }
  return `${adults}${children}${seatsInfo}`;
}

function getSearchResults() {
  const exact = appData.trips.filter(trip => trip.boarding === state.searchFrom && trip.destination === state.searchTo);
  if (exact.length) return exact;
  return appData.trips.map(trip => ({ ...trip, boarding: state.searchFrom, destination: state.searchTo }));
}

function getVehicleCapacity(trip) {
  if (trip && trip.vehicle && (trip.vehicle.toLowerCase().includes('highroof') || trip.vehicle.includes('18'))) return 18;
  return 14; // Commuter
}

function captureFocusDescriptor(root) {
  const active = document.activeElement;
  if (!active || !root?.contains(active)) return null;
  const keys = ['action', 'screen', 'value', 'seat', 'id', 'field'];
  const descriptor = {};
  keys.forEach(key => {
    if (active.dataset?.[key] !== undefined) descriptor[key] = active.dataset[key];
  });
  if (active.name) descriptor.controlName = active.name;
  if (active.value && (active.name || active.matches('input, select, textarea'))) descriptor.controlValue = active.value;
  if (active.dataset?.parcelField) descriptor.parcelField = active.dataset.parcelField;
  if (active.dataset?.passengerField) descriptor.passengerField = active.dataset.passengerField;
  if (active.dataset?.passengerIndex) descriptor.passengerIndex = active.dataset.passengerIndex;
  return Object.keys(descriptor).length ? descriptor : null;
}

function restoreDescribedFocus(root, descriptor) {
  if (!descriptor) return;
  const candidates = $$('button, input, select, textarea, [data-action], [data-screen], [data-field]', root);
  const match = candidates.find(element => Object.entries(descriptor).every(([key, value]) => {
    if (key === 'controlName') return element.name === value;
    if (key === 'controlValue') return element.value === value;
    return element.dataset?.[key] === value;
  }));
  match?.focus({ preventScroll: true });
}

function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  upgradeSelects();
  upgradeDateInputs();
}

/* ─── Modern Custom Select Dropdown Component ─── */
function upgradeSelects() {
  document.querySelectorAll('select:not(.native-select-hidden)').forEach(sel => {
    // Skip selects inside elements that shouldn't be upgraded
    if (sel.closest('.custom-select')) return;

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';

    // Copy any id or data attributes for external access
    const selId = sel.id;

    // Determine selected option text
    const selectedOpt = sel.options[sel.selectedIndex];
    const isPlaceholder = !selectedOpt || selectedOpt.disabled || selectedOpt.value === '' || selectedOpt.hidden;
    const displayText = isPlaceholder ? 'Select' : selectedOpt.textContent;

    // Build trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `custom-select-trigger${isPlaceholder ? ' is-placeholder' : ''}`;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `
      <span class="custom-select-trigger-label">${escapeHtml(displayText)}</span>
      <span class="custom-select-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
    `;

    // Hide native select but keep it in the DOM for form data and event compatibility
    sel.classList.add('native-select-hidden');
    sel.setAttribute('tabindex', '-1');

    // Insert wrapper
    sel.parentNode.insertBefore(wrapper, sel);
    wrapper.appendChild(sel);
    wrapper.appendChild(trigger);

    // Click trigger to open/close
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = wrapper.classList.contains('is-open');

      // Close all other open custom selects
      document.querySelectorAll('.custom-select.is-open').forEach(other => {
        if (other !== wrapper) closeCustomSelect(other);
      });

      if (wasOpen) {
        closeCustomSelect(wrapper);
      } else {
        openCustomSelect(wrapper, sel, trigger);
      }
    });
  });
}

function openCustomSelect(wrapper, sel, trigger) {
  // Build options panel
  const optionsPanel = document.createElement('div');
  optionsPanel.className = 'custom-select-options';
  optionsPanel.setAttribute('role', 'listbox');

  Array.from(sel.options).forEach((opt, idx) => {
    // Skip disabled or hidden placeholder option ("Select") from list so it cannot be selected
    if (opt.disabled || opt.hidden || opt.value === '') return;

    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = `custom-select-option${idx === sel.selectedIndex ? ' is-selected' : ''}`;
    optBtn.setAttribute('role', 'option');
    optBtn.setAttribute('aria-selected', idx === sel.selectedIndex);
    optBtn.innerHTML = `
      <span class="custom-select-option-check"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
      <span>${escapeHtml(opt.textContent)}</span>
    `;

    optBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      trigger.querySelector('.custom-select-trigger-label').textContent = opt.textContent;
      trigger.classList.remove('is-placeholder');
      closeCustomSelect(wrapper);
    });

    optionsPanel.appendChild(optBtn);
  });

  wrapper.appendChild(optionsPanel);
  wrapper.classList.add('is-open');
  trigger.setAttribute('aria-expanded', 'true');

  const parentCard = wrapper.closest('.vehicle-card') || wrapper.closest('.card');
  if (parentCard) parentCard.classList.add('has-open-dropdown');

  // Check if dropdown would go off-screen and flip upward
  requestAnimationFrame(() => {
    const rect = optionsPanel.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 10) {
      optionsPanel.classList.add('drop-up');
    }
  });

  // Close when clicking outside
  const closeHandler = (e) => {
    if (!wrapper.contains(e.target)) {
      closeCustomSelect(wrapper);
      document.removeEventListener('click', closeHandler, true);
    }
  };
  wrapper._closeHandler = closeHandler;
  setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
}

function closeCustomSelect(wrapper) {
  wrapper.classList.remove('is-open');
  const parentCard = wrapper.closest('.vehicle-card') || wrapper.closest('.card');
  if (parentCard) parentCard.classList.remove('has-open-dropdown');
  const trigger = wrapper.querySelector('.custom-select-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  const panel = wrapper.querySelector('.custom-select-options');
  if (panel) panel.remove();
  if (wrapper._closeHandler) {
    document.removeEventListener('click', wrapper._closeHandler, true);
    delete wrapper._closeHandler;
  }
}

/* ─── Modern Custom Date Selector Component ─── */
function formatFriendlyDate(isoStr) {
  if (!isoStr) return 'Select Date';
  const parts = String(isoStr).split('-');
  if (parts.length !== 3) return isoStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return isoStr;
  const d = new Date(year, month, day);
  if (isNaN(d.getTime())) return isoStr;
  
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function upgradeDateInputs() {
  document.querySelectorAll('input[type="date"]:not(.native-date-hidden)').forEach(dateInput => {
    if (dateInput.closest('.custom-date-picker')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-date-picker';

    const initialVal = dateInput.value || '';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `custom-date-trigger${!initialVal ? ' is-placeholder' : ''}`;
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `
      <span class="custom-date-trigger-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
      </span>
      <span class="custom-date-trigger-label">${formatFriendlyDate(initialVal)}</span>
      <span class="custom-date-chevron">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    `;

    dateInput.classList.add('native-date-hidden');
    dateInput.setAttribute('tabindex', '-1');

    dateInput.parentNode.insertBefore(wrapper, dateInput);
    wrapper.appendChild(dateInput);
    wrapper.appendChild(trigger);

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = wrapper.classList.contains('is-open');

      document.querySelectorAll('.custom-date-picker.is-open').forEach(other => {
        if (other !== wrapper) closeCustomDatePicker(other);
      });

      if (wasOpen) {
        closeCustomDatePicker(wrapper);
      } else {
        openCustomDatePicker(wrapper, dateInput, trigger);
      }
    });
  });
}

function openCustomDatePicker(wrapper, dateInput, trigger) {
  let currentDate = dateInput.value ? new Date(dateInput.value + 'T00:00:00') : new Date();
  if (isNaN(currentDate.getTime())) currentDate = new Date();

  let viewYear = currentDate.getFullYear();
  let viewMonth = currentDate.getMonth();

  const minDateStr = dateInput.getAttribute('min') || '';
  let minDate = minDateStr ? new Date(minDateStr + 'T00:00:00') : null;
  if (minDate && isNaN(minDate.getTime())) minDate = null;

  const popover = document.createElement('div');
  popover.className = 'custom-date-popover';

  function renderCalendar() {
    popover.innerHTML = '';

    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const navHeader = document.createElement('div');
    navHeader.className = 'custom-date-header';
    navHeader.innerHTML = `
      <button type="button" class="custom-date-nav-btn prev-month" aria-label="Previous month">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="custom-date-month-title">${months[viewMonth]} ${viewYear}</span>
      <button type="button" class="custom-date-nav-btn next-month" aria-label="Next month">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `;

    navHeader.querySelector('.prev-month').addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendar();
    });

    navHeader.querySelector('.next-month').addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendar();
    });

    popover.appendChild(navHeader);

    const weekHead = document.createElement('div');
    weekHead.className = 'custom-date-weekdays';
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(d => {
      const span = document.createElement('span');
      span.textContent = d;
      weekHead.appendChild(span);
    });
    popover.appendChild(weekHead);

    const daysGrid = document.createElement('div');
    daysGrid.className = 'custom-date-days-grid';

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const emptyCell = document.createElement('span');
      emptyCell.className = 'custom-date-empty';
      daysGrid.appendChild(emptyCell);
    }

    const today = new Date();
    const selectedIso = dateInput.value;

    for (let day = 1; day <= totalDays; day++) {
      const thisDate = new Date(viewYear, viewMonth, day);
      const isoString = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'custom-date-day';

      const isSelected = selectedIso === isoString;
      const isToday = today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;
      const isDisabled = minDate && thisDate < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());

      if (isSelected) dayBtn.classList.add('is-selected');
      if (isToday) dayBtn.classList.add('is-today');
      if (isDisabled) {
        dayBtn.classList.add('is-disabled');
        dayBtn.disabled = true;
      }

      dayBtn.textContent = day;

      if (!isDisabled) {
        dayBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dateInput.value = isoString;
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
          trigger.querySelector('.custom-date-trigger-label').textContent = formatFriendlyDate(isoString);
          trigger.classList.remove('is-placeholder');
          closeCustomDatePicker(wrapper);
        });
      }

      daysGrid.appendChild(dayBtn);
    }

    popover.appendChild(daysGrid);

    const shortcutsBar = document.createElement('div');
    shortcutsBar.className = 'custom-date-shortcuts';

    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const shortcuts = [
      { label: 'Today', iso: todayIso },
      { label: 'Tomorrow', iso: tomorrowIso }
    ];

    shortcuts.forEach(sc => {
      const scBtn = document.createElement('button');
      scBtn.type = 'button';
      scBtn.className = 'custom-date-shortcut-btn';
      scBtn.textContent = sc.label;

      const scDate = new Date(sc.iso + 'T00:00:00');
      if (minDate && scDate < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) {
        scBtn.disabled = true;
        scBtn.classList.add('is-disabled');
      } else {
        scBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dateInput.value = sc.iso;
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
          trigger.querySelector('.custom-date-trigger-label').textContent = formatFriendlyDate(sc.iso);
          trigger.classList.remove('is-placeholder');
          closeCustomDatePicker(wrapper);
        });
      }
      shortcutsBar.appendChild(scBtn);
    });

    popover.appendChild(shortcutsBar);
  }

  renderCalendar();

  wrapper.appendChild(popover);
  wrapper.classList.add('is-open');
  trigger.setAttribute('aria-expanded', 'true');

  const closeHandler = (e) => {
    if (!wrapper.contains(e.target)) {
      closeCustomDatePicker(wrapper);
      document.removeEventListener('click', closeHandler, true);
    }
  };
  wrapper._dateCloseHandler = closeHandler;
  setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
}

function closeCustomDatePicker(wrapper) {
  wrapper.classList.remove('is-open');
  const trigger = wrapper.querySelector('.custom-date-trigger');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  const popover = wrapper.querySelector('.custom-date-popover');
  if (popover) popover.remove();
  if (wrapper._dateCloseHandler) {
    document.removeEventListener('click', wrapper._dateCloseHandler, true);
    delete wrapper._dateCloseHandler;
  }
}

function setTodayDefaults() {
  const today = new Date();
  const iso = today.toISOString().split('T')[0];
  document.documentElement.style.setProperty('--today', `'${iso}'`);
}

function initHorizontalMouseWheelScroll() {
  document.body.addEventListener('wheel', (e) => {
    const scrollContainer = e.target.closest('.departure-scroll, .services-scroll, .horizontal-scroll, [data-horizontal-scroll]');
    if (!scrollContainer) return;

    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scrollContainer.scrollLeft += e.deltaY * 1.25;
    }
  }, { passive: false });
}

function init() {
  setTodayDefaults();
  renderOnboarding();
  renderNavigation();
  initOnboardingSwipe();
  initHorizontalMouseWheelScroll();
  
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
  document.addEventListener('submit', event => event.preventDefault());
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('scroll', handleTripReviewScroll, { passive: true });
  refreshIcons();
  preloadTransparentImages();

  const urlParams = new URLSearchParams(window.location.search);
  const targetScreen = urlParams.get('screen') || window.location.hash.slice(1);
  const validScreens = ['home','book','special-hire','trip-details','passengers','returns','luggage','checkout','success','ticket','trips','live','wallet','parcel','parcel-receipt','trackparcel-list','trackparcel','parcel-status','offers','notifications','support','profile','about','tracking','search-results','login-logs'];

  // Restore authenticated session metadata
  const activeSession = getAuthSession();
  if (activeSession && activeSession.username) {
    state.userName = activeSession.name || state.userName;
    state.userAvatar = activeSession.avatar || state.userAvatar;
    state.lastLoginTime = activeSession.loginDisplayTime || state.lastLoginTime;
  }

  // Strict Platform Gate: "No access without it"
  if (!isPlatformAuthenticated()) {
    if (targetScreen && validScreens.includes(targetScreen)) {
      state.intendedScreen = targetScreen;
    }
    $('#app-shell').classList.add('is-hidden');
    $('#splash-screen').classList.add('is-hidden');
    $('#onboarding').classList.add('is-hidden');
    $('#auth-layer').classList.remove('is-hidden');
    state.authView = 'signin';
    renderAuth();
    updateLoginLogBadges();
    return;
  }


  if (targetScreen && validScreens.includes(targetScreen)) {
    $('#splash-screen').classList.add('is-hidden');
    $('#onboarding').classList.add('is-hidden');
    $('#auth-layer').classList.add('is-hidden');
    $('#app-shell').classList.remove('is-hidden');
    navigate(targetScreen, {}, false);
    return;
  }

  // Preload all splash/onboarding images during initial splash page
  const minSplashDelay = new Promise(resolve => setTimeout(resolve, 1800));
  Promise.all([preloadSplashImages(), minSplashDelay]).then(() => {
    const splash = $('#splash-screen');
    if (!splash.classList.contains('is-hidden')) {
      showOnboarding();
    }
  });

  // Auto-detect nearest city after initial render
  detectNearestCity();
}

function preloadSplashImages() {
  const splashImages = [
    'assets/peebee-logo.svg',
    'assets/taxibee-onboarding1-branded.png',
    'assets/taxibee-onboarding2-branded.png',
    'assets/taxibee-onboarding3-branded.png'
  ];

  return Promise.all(splashImages.map(src => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }));
}

// The live adapter installs before initialization.

function showOnboarding() {
  $('#splash-screen').classList.add('is-leaving');
  setTimeout(() => {
    $('#splash-screen').classList.add('is-hidden');
    $('#onboarding').classList.remove('is-hidden');
    renderOnboarding();
  }, 300);
}

let onboardingSwipeInitialized = false;

function initOnboardingSwipe() {
  if (onboardingSwipeInitialized) return;
  const onboardingEl = $('#onboarding');
  if (!onboardingEl) return;

  onboardingSwipeInitialized = true;
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  const getContent = () => $('#onboarding-content');

  const handleStart = (e) => {
    if (onboardingEl.classList.contains('is-hidden')) return;
    isDragging = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    currentX = startX;
    const content = getContent();
    if (content) content.style.transition = 'none';
  };

  const handleMove = (e) => {
    if (!isDragging) return;
    currentX = e.touches ? e.touches[0].clientX : e.clientX;
    const diffX = currentX - startX;
    const content = getContent();
    if (content) {
      let clamped = diffX;
      if ((state.onboardingIndex === 0 && diffX > 0) || (state.onboardingIndex === 2 && diffX < 0)) {
        clamped = diffX * 0.25;
      }
      const progress = Math.min(1, Math.abs(clamped) / 320);
      const scale = Math.max(0.85, 1 - progress * 0.15);
      const opacity = Math.max(0.2, 1 - progress * 0.75);

      content.style.transform = `translateX(${clamped}px) scale(${scale})`;
      content.style.opacity = opacity;
    }
  };

  const handleEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const diffX = currentX - startX;
    const content = getContent();

    if (diffX < -45) {
      if (state.onboardingIndex < onboardingSlides.length - 1) {
        state.onboardingIndex += 1;
        renderOnboarding();
      } else if (state.onboardingIndex === 2) {
        showAuth('signin');
      }
    } else if (diffX > 45) {
      if (state.onboardingIndex > 0) {
        state.onboardingIndex -= 1;
        renderOnboarding();
      }
    } else {
      if (content) {
        content.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.28s ease';
        content.style.transform = 'translateX(0) scale(1)';
        content.style.opacity = '1';
      }
    }
  };

  onboardingEl.addEventListener('touchstart', handleStart, { passive: true });
  onboardingEl.addEventListener('touchmove', handleMove, { passive: true });
  onboardingEl.addEventListener('touchend', handleEnd, { passive: true });

  onboardingEl.addEventListener('mousedown', handleStart);
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);
}

function renderOnboarding() {
  const slide = onboardingSlides[state.onboardingIndex];
  const content = $('#onboarding-content');
  if (!content) return;

  content.style.transition = 'none';
  content.style.transform = '';
  content.style.opacity = '1';

  content.innerHTML = `
    <article class="onboarding-slide">
      <div class="onboarding-image-container" style="position: relative;">
        <img src="assets/onboarding-${state.onboardingIndex + 1}.${state.onboardingIndex === 1 ? 'webp' : 'jpg'}" alt="${escapeHtml(slide.title)} visual">
      </div>
      <div class="onboarding-copy">
        <h2>${slide.title}</h2>
        <p>${slide.message}</p>

        ${state.onboardingIndex < 2 ? `
          <div class="onboarding-controls">
            <button class="button button--primary onboarding-chevron-btn" type="button" data-action="onboarding-next" aria-label="Next slide">
              <i data-lucide="chevron-right"></i>
            </button>
          </div>
        ` : `
          <div class="onboarding-last-buttons" style="margin-top: 24px; width: 100%; max-width: 260px;">
            <button class="button button--primary w-full" type="button" data-action="skip-onboarding" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
              <span>Get Started</span>
              <i data-lucide="arrow-right"></i>
            </button>
          </div>
        `}
      </div>
    </article>
  `;

  // Update controls visibility
  const skipBtn = $('.onboarding-skip');
  if (skipBtn) {
    skipBtn.classList.toggle('is-hidden', state.onboardingIndex === 2);
  }

  refreshIcons();
}

function showAuth(view = 'signin') {
  state.authView = view;
  $('#onboarding').classList.add('is-hidden');
  $('#splash-screen').classList.add('is-hidden');
  $('#auth-layer').classList.remove('is-hidden');
  renderAuth();
}

function renderAuth() {
  const root = $('#auth-content');
  const copy = `
    <div class="auth-copy">
      <p class="eyebrow">Travel Smart. Move Faster.</p>
      <h1>A more reliable way to travel.</h1>
      <p>Preview passenger booking, digital tickets, wallet payments, return travel, luggage handling and same-corridor parcel delivery.</p>
      <div class="auth-trust">
        <div class="auth-trust-item"><span><i data-lucide="shield-check"></i></span>Protected platform · Audited access</div>
        <div class="auth-trust-item"><span><i data-lucide="route"></i></span>Scheduled and stage-based travel</div>
        <div class="auth-trust-item"><span><i data-lucide="package-check"></i></span>Traceable parcels and luggage</div>
      </div>
    </div>`;

  let card = '';
  const googleBtnSvg = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l-.02.13 2.67 2.07.18.02c1.7-1.57 2.69-3.88 2.69-6.64z" fill="#1a1a1a"/><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.41-1.57-5.13-3.72l-.14.01-2.73 2.11-.04.13C2.45 16.03 5.49 18 9 18z" fill="#34A853"/><path d="M3.87 10.8c-.2-.58-.31-1.2-.31-1.8s.11-1.22.31-1.8v-.14L1.1 4.92l-.12.06C.35 6.27 0 7.59 0 9s.35 2.73.98 4.02l2.89-2.22z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.49 0 2.45 1.97.98 4.98l2.89 2.24C4.59 5.07 6.62 3.58 9 3.58z" fill="#EA4335"/></svg>`;

  if (state.authView === 'signin') {
    card = `
      <div id="signin-card" class="auth-card">
        <div class="auth-security-badge">
          <i data-lucide="shield-check"></i>
          <span>Secure Gate · Access Audited</span>
        </div>
        <p class="eyebrow">Platform Access</p>
        <h2>Sign in to Taxibee</h2>
        <p class="muted">Enter authorized username and passcode. No access without credentials.</p>

        <div id="signin-error" class="auth-error-banner is-hidden" role="alert" aria-live="assertive">
          <i data-lucide="alert-circle"></i>
          <span id="signin-error-text">Invalid username or passcode.</span>
        </div>

        <form id="signin-form" autocomplete="on" novalidate onsubmit="handlePlatformLogin(event)">
          <div class="field">
            <label for="signin-username">Username or Telephone</label>
            <div class="input-group">
              <span class="input-prefix"><i data-lucide="user"></i></span>
              <input 
                id="signin-username" 
                name="username" 
                type="text" 
                autocomplete="username" 
                autocapitalize="none" 
                autocorrect="off" 
                spellcheck="false" 
                required 
                placeholder="e.g. admin or christo" 
                value=""
                enterkeyhint="next"
              >
            </div>
            <small class="field-help">Your authorized platform username.</small>
          </div>

          <div class="field" style="margin-top: 14px;">
            <div class="auth-passcode-row">
              <label for="signin-passcode">Passcode</label>
              <button type="button" class="text-button text-small" data-action="toggle-passcode-visibility" style="font-size: 0.74rem; text-decoration: none; color: var(--brand-blue);" id="toggle-passcode-btn">
                Show passcode
              </button>
            </div>
            <div class="input-group">
              <span class="input-prefix"><i data-lucide="lock"></i></span>
              <input 
                id="signin-passcode" 
                name="password" 
                type="password" 
                autocomplete="current-password" 
                required 
                placeholder="Enter passcode" 
                value=""
                enterkeyhint="done"
              >
            </div>
            <small class="field-help">Protected key for this account.</small>
          </div>

          <label class="checkbox-row" style="margin-top: 14px; font-size: 0.84rem;">
            <input id="signin-remember" type="checkbox" checked>
            <span>Remember session on this device</span>
          </label>

          <button class="button button--primary w-full" type="submit" id="signin-submit-btn" style="margin-top: 18px; height: 48px; font-size: 1rem; font-weight: 750; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i data-lucide="log-in"></i>
            <span>Sign In to Platform</span>
          </button>
        </form>

        

        <p class="center text-small" style="margin: 16px 0 0;">
          Need a new account? <button class="text-button" type="button" data-action="show-registration">Register with Passcode</button>
        </p>

        <p class="privacy-note" style="text-align: center; margin-top: 12px; font-size: 0.74rem;">
          <i data-lucide="shield" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
          Every sign-in attempt is permanently logged with timestamp for security.
        </p>
      </div>`;
  } else if (state.authView === 'otp') {
    card = `
      <div class="auth-card">
        <button class="text-button" type="button" data-action="auth-back">← Back</button>
        <p class="eyebrow">Verification preview</p>
        <h2>Enter the four-digit code</h2>
        <p class="muted">A demonstration code was prepared for +256 772 345 678.</p>
        <div class="otp-grid" aria-label="One-time password">
          ${[1,2,3,4].map((n, i) => `<input class="otp-input" maxlength="1" inputmode="numeric" value="${i + 1}" aria-label="Digit ${n}">`).join('')}
        </div>
        <div class="demo-hint">Demo hint: use <strong>1234</strong>. No real code was sent.</div>
        <button class="button button--primary w-full" style="margin-top:18px" type="button" data-action="verify-otp">Verify and Continue</button>
        <div class="button-row" style="justify-content:space-between;margin-top:10px"><button class="text-button" type="button" data-action="change-number">Change number</button><button class="text-button" type="button" data-action="resend-otp">Resend in <span id="otp-countdown">30</span>s</button></div>
      </div>`;
  } else if (state.authView === 'create-verify') {
    card = `
      <div class="auth-card">
        <button class="text-button" type="button" data-action="show-registration">← Back to details</button>
        <p class="eyebrow">Step 2 of 2 · Verification & Security</p>
        <h2>Verify Account & Set PIN</h2>
        <div class="notice" style="background: var(--info-soft); border-left: 4px solid var(--brand-blue); padding: 12px 14px; border-radius: 12px; margin: 12px 0 16px; font-size: 0.86rem; color: var(--brand-blue-dark); display: flex; align-items: flex-start; gap: 10px;">
          <i data-lucide="bell-ring" style="width: 20px; height: 20px; flex-shrink: 0; color: var(--brand-blue); margin-top: 2px;"></i>
          <div>
            <strong>Verification message sent!</strong>
            <div style="font-size: 0.8rem; color: var(--slate); margin-top: 2px;">We sent a verification SMS to <strong>+256 772 345 678</strong>.</div>
          </div>
        </div>
        <div class="field field--full" style="margin-bottom: 14px;">
          <label for="reg-pin" style="font-weight: 700;">Set your 4-digit Wallet PIN</label>
          <input id="reg-pin" inputmode="numeric" maxlength="4" value="2580" type="password" style="font-size: 1.25rem; letter-spacing: 0.3em; text-align: center; font-weight: 800; border-radius: 12px;">
          <small class="field-help">Used to authorize Taxibee Wallet transactions.</small>
        </div>
        <p class="muted text-small" style="margin-bottom: 8px; font-weight: 600;">4-Digit SMS Verification Code:</p>
        <div class="otp-grid" aria-label="One-time password">
          ${[1,2,3,4].map((n, i) => `<input class="otp-input" maxlength="1" inputmode="numeric" value="${i + 1}" aria-label="Digit ${n}">`).join('')}
        </div>
        <button class="button button--primary w-full" style="margin-top:18px" type="button" data-action="create-account">Verify &amp; Create Account</button>
      </div>`;
  } else {
    card = `
      <div class="auth-card">
        <button class="text-button" type="button" data-action="auth-back">← Back to Sign In</button>
        <p class="eyebrow">Passenger Registration</p>
        <h2>Register Passenger Account</h2>
        <p class="muted">Create your username and passcode to access Taxibee.</p>
        <form id="register-form" onsubmit="handlePlatformRegister(event)">
          <div class="form-grid">
            <div class="field field--full"><label for="reg-name">Full name</label><input id="reg-name" name="name" type="text" autocomplete="name" required value="Christo I."></div>
            <div class="field field--full"><label for="reg-username">Username</label><input id="reg-username" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required placeholder="Choose a username" value="christo_passenger"></div>
            <div class="field field--full"><label for="reg-passcode">Choose Passcode</label><input id="reg-passcode" name="new-password" type="password" autocomplete="new-password" required placeholder="Create a secure passcode" value=""></div>
            <div class="field field--full"><label for="reg-email">Email address <span class="muted">(optional)</span></label><input id="reg-email" name="email" type="email" autocomplete="email" value="christo.i@example.com"></div>
          </div>
          <button class="button button--primary w-full" style="margin-top: 18px; height: 46px; font-weight: 750;" type="submit">Create Account &amp; Sign In</button>
        </form>
      </div>`;
  }
  root.innerHTML = `<div class="auth-grid">${copy}${card}</div>`;
  refreshIcons();
  if (state.authView === 'otp') startOtpCountdown();
}
let otpTimer;
function startOtpCountdown() {
  clearInterval(otpTimer);
  let remaining = 30;
  otpTimer = setInterval(() => {
    remaining -= 1;
    const el = $('#otp-countdown');
    if (el) el.textContent = remaining;
    if (remaining <= 0) clearInterval(otpTimer);
  }, 1000);
}

function enterApp(message = 'Welcome to Taxibee.') {
  clearInterval(otpTimer);
  $('#auth-layer').classList.add('is-hidden');
  $('#onboarding').classList.add('is-hidden');
  $('#app-shell').classList.remove('is-hidden');
  const dest = state.intendedScreen || 'home';
  state.intendedScreen = null;
  navigate(dest, {}, false);
  toast(message, 'success');
  updateLoginLogBadges();
  return;
}

function getNavigationHtml(context) {
  const itemClass = context === 'drawer' ? 'drawer-nav-item' : 'nav-item';
  const activeHome = state.screen === 'home' ? 'is-active' : '';
  const activeDepartures = state.screen === 'available-vans' ? 'is-active' : '';
  const activeBook = state.screen === 'book' ? 'is-active' : '';
  const activeTickets = state.screen === 'tickets' ? 'is-active' : '';
  const activeSpecialHire = state.screen === 'special-hire' ? 'is-active' : '';
  const activeTrips = state.screen === 'trips' ? 'is-active' : '';
  const activeWallet = state.screen === 'wallet' ? 'is-active' : '';
  const activeParcel = state.screen === 'parcel' ? 'is-active' : '';
  const activeTracking = state.screen === 'tracking' ? 'is-active' : '';
  const activeOffers = state.screen === 'offers' ? 'is-active' : '';
  const activeSupport = state.screen === 'support' ? 'is-active' : '';
  const activeAbout = state.screen === 'about' ? 'is-active' : '';

  return `
    <button class="${itemClass} ${activeHome}" type="button" data-screen="home">
      <i data-lucide="house"></i><span>Home</span>
    </button>
    
    <button class="${itemClass} ${activeDepartures}" type="button" data-screen="available-vans">
      <i data-lucide="clock-arrow-up"></i><span>Departures</span>
    </button>

    <button class="${itemClass} ${activeBook}" type="button" data-screen="book">
      <i data-lucide="ticket-plus"></i><span>Book a Travel</span>
    </button>

    <button class="${itemClass} ${activeTickets}" type="button" data-screen="tickets">
      <i data-lucide="ticket"></i><span>My Tickets</span>
    </button>

    <button class="${itemClass} ${activeSpecialHire}" type="button" data-screen="special-hire">
      <i data-lucide="bus"></i><span>Special Hire</span>
    </button>

    <button class="${itemClass} ${activeTrips}" type="button" data-screen="trips">
      <i data-lucide="route"></i><span>My Travels</span>
    </button>

    <button class="${itemClass} ${activeWallet}" type="button" data-screen="wallet">
      <i data-lucide="wallet-cards"></i><span>Wallet</span>
    </button>

    <button class="${itemClass} ${activeParcel}" type="button" data-screen="parcel">
      <i data-lucide="package-plus"></i><span>Parcels</span>
    </button>

    <button class="${itemClass} ${activeTracking}" type="button" data-screen="tracking">
      <i data-lucide="navigation"></i><span>Tracking</span>
    </button>

    <button class="${itemClass} ${activeOffers}" type="button" data-screen="offers">
      <i data-lucide="badge-percent"></i><span>Offers</span>
    </button>

    <button class="${itemClass} ${activeSupport}" type="button" data-screen="support">
      <i data-lucide="life-buoy"></i><span>Help & Support</span>
    </button>

    <button class="${itemClass} ${activeAbout}" type="button" data-screen="about">
      <i data-lucide="info"></i><span>About Taxibee</span>
    </button>

    <button class="${itemClass} ${state.screen === 'login-logs' ? 'is-active' : ''}" type="button" data-screen="login-logs">
      <i data-lucide="shield-check"></i><span>Login Logs</span>
    </button>
  `;
}

function alignMobileMenu(menu, animate = false) {
  if (!menu.clientWidth) return;
  const active = menu.querySelector('[aria-current="page"]');
  const item = active?.parentElement;
  let left = item?.offsetLeft ?? 0;
  if (item && matchMedia('(min-width: 420px)').matches) {
    left -= (menu.clientWidth - item.offsetWidth) / 2;
  }
  left = Math.max(0, Math.min(left, menu.scrollWidth - menu.clientWidth));
  menu.scrollTo({ left, behavior: animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
}

function renderNavigation() {
  const desktop = $('#desktop-nav');
  const mobile = $('#mobile-nav');
  const drawerList = $('.side-drawer__content .drawer-nav');
  
  if (desktop) {
    desktop.innerHTML = getNavigationHtml('desktop');
  }
  if (drawerList) {
    drawerList.innerHTML = getNavigationHtml('drawer');
  }
  
  if (mobile) {
    const isBookingFlow = ['book', 'trip-details', 'passengers', 'returns', 'luggage', 'checkout', 'trackparcel', 'parcel-status', 'special-hire', 'driver-call', 'driver-chat'].includes(state.screen);
    const isBookStep1 = state.screen === 'book' && (state.bookingStep || 1) === 1;
    if (isBookingFlow && !isBookStep1) {
      mobile.classList.add('is-hidden');
    } else {
      mobile.classList.remove('is-hidden');
    }
    const flowScreen = ['trip-details','passengers','returns','luggage','checkout'].includes(state.screen);
    const activeScreen = screen => {
      if (screen === 'book' && flowScreen) return true;
      if (screen === 'tickets' && ['ticket','success'].includes(state.screen)) return true;
      if (screen === 'trips' && ['live','tracking'].includes(state.screen)) return true;
      return state.screen === screen;
    };
    let menu = mobile.querySelector('.taxibee-nav-items');
    const initial = !menu;
    if (initial) {
      const items = [['available-vans','Departures','clock-arrow-up'],['book','Book','ticket-plus'],['tickets','Tickets','ticket'],['trips','Travels','route'],['wallet','Wallet','wallet-cards']];
      mobile.innerHTML = `
      <div class="taxibee-nav-shell" style="--nav-count: ${items.length}">
        <div class="taxibee-nav-anchor">
          <button class="taxibee-nav-home" type="button" data-screen="home">
            <i data-lucide="house" aria-hidden="true"></i><span>Home</span>
          </button>
        </div>
        <div class="taxibee-nav-menu-track">
          <ul class="taxibee-nav-items" aria-label="Main destinations">
            ${items.map(([screen,label,icon]) => `<li><button class="mobile-nav-item" type="button" data-screen="${screen}">
                <i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span>
              </button></li>`).join('')}
          </ul>
        </div>
      </div>`;
      menu = mobile.querySelector('.taxibee-nav-items');
      if ('ResizeObserver' in window) new ResizeObserver(() => alignMobileMenu(menu)).observe(menu);
    }
    const previous = menu.querySelector('[aria-current="page"]');
    for (const button of mobile.querySelectorAll('button[data-screen]')) {
      const active = activeScreen(button.dataset.screen);
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (initial || previous !== menu.querySelector('[aria-current="page"]')) alignMobileMenu(menu, !initial);
  }
  refreshIcons();
}

function navigate(screen, payload = {}, pushHistory = true) {
  if (!isPlatformAuthenticated()) {
    state.intendedScreen = screen;
    showAuth('signin');
    return;
  }
  if (pushHistory && state.screen && state.screen !== screen) state.history.push(state.screen);
  if (screen !== 'book' && !['trip-details', 'passengers', 'returns', 'luggage', 'checkout'].includes(screen)) {
    state.selectedRoute = null;
  }
  state.screen = screen;
  document.body.setAttribute('data-active-screen', screen);
  Object.assign(state, payload);
  const title = screenTitles[screen] || 'Taxibee';
  $('#screen-title').textContent = title;
  const isHome = screen === 'home';
  $('#back-button').classList.toggle('is-hidden', isHome);
  const mobileBrand = document.querySelector('.mobile-brand');
  if (mobileBrand) mobileBrand.classList.toggle('is-hidden', !isHome);
  $('#topbar-share-button')?.classList.toggle('is-hidden', screen !== 'parcel-status');
  renderNavigation();
  renderCurrentScreen(false);
  window.scrollTo({ top: 0, behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
  setTimeout(() => {
    const target = screen === 'success' ? $('#success-title') : $('#main-content h1') || $('#main-content');
    if (target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
  }, 20);
}

function goBack() {
  if ((state.screen === 'tracking' && state.trackingView === 'single') || state.screen === 'trackparcel' || state.screen === 'parcel-status') {
    state.screen = 'tracking';
    state.trackingView = 'hub';
    state.selectedTrackingId = null;
    $('#screen-title').textContent = 'Tracking';
    renderNavigation();
    renderCurrentScreen();
    return;
  }
  const previous = state.history.pop() || 'home';
  state.screen = previous;
  navigate(previous, {}, false);
}

function renderCurrentScreen(preserveFocus = true) {
  const root = $('#main-content');
  const focusDescriptor = preserveFocus ? captureFocusDescriptor(root) : null;
  destroyTripMap();
  const renderers = {
    home: renderHome, book: renderBook, 'special-hire': renderSpecialHire, 'trip-details': renderTripDetails, passengers: renderPassengers, returns: renderReturns,
    luggage: renderLuggage, checkout: renderCheckout, success: renderSuccess, ticket: renderTicket, tickets: renderTickets, trips: renderTrips,
    live: renderTracking, wallet: renderWallet, parcel: renderParcelBooking, 'parcel-receipt': renderParcelReceipt,
    trackparcel: renderParcelTracking, 'trackparcel-list': renderParcelList, 'parcel-status': renderParcelStatus, 'driver-profile': renderDriverProfile, 'driver-chat': renderDriverChat, 'driver-call': renderDriverCall, offers: renderOffers, notifications: renderNotifications, support: renderSupport,
    profile: renderProfile, about: renderAbout, tracking: renderTracking, 'search-results': renderSearchResultsScreen, 'available-vans': renderAvailableVansScreen, 'login-logs': renderLoginLogsScreen
  };
  root.innerHTML = (renderers[state.screen] || renderHome)();
  refreshIcons();
  updateHeaderTheme();
  renderNavigation();
  if (state.screen === 'trip-details') setTimeout(() => { if (state.screen === 'trip-details') initTripMap(); }, 240);
  if (state.screen === 'book' && (state.bookingStep || 1) === 2) setTimeout(() => { if (state.screen === 'book' && state.bookingStep === 2) initBookingStep2Map(); }, 240);
  if (state.screen === 'ticket') setTimeout(initTicketQr, 0);
  if (state.screen === 'parcel-receipt') setTimeout(() => { initParcelBarcode(); initQrFor('parcel-qr', 'TAXIBEE|PARCEL|#964201832-DL|742915'); }, 0);
  if (state.screen === 'special-hire' && state.specialHire.step === 4) setTimeout(() => { initQrFor('hire-qr', 'TAXIBEE|HIRE|#SH-98402-UG|984021'); }, 0);
  if (focusDescriptor) setTimeout(() => restoreDescribedFocus(root, focusDescriptor), 20);
  if (state.screen === 'live') {
    startLiveProgress();
    setTimeout(() => { if (state.screen === 'live') initLiveTravelMap(); }, 240);
  } else {
    stopLiveProgress();
  }
  if (state.screen === 'home') setTimeout(initHomeCarousel, 50);
  if (state.screen === 'tracking') {
    if (state.trackingView === 'single') {
      setTimeout(initTrackingMap, 240);
    } else {
      setTimeout(initTrackingCardMaps, 200);
    }
  }
}

function initHomeCarousel() {
  const carousel = $('#departureCarousel');
  if (!carousel) return;
  let scrollTimer;
  carousel.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const cards = $$('.departure-card', carousel);
      const center = carousel.scrollLeft + carousel.clientWidth / 2;
      let nearest = 0, distance = Infinity;
      cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const nextDistance = Math.abs(center - cardCenter);
        if (nextDistance < distance) {
          distance = nextDistance;
          nearest = index;
        }
      });
      $$('.carousel-dot').forEach((dot, index) => {
        dot.classList.toggle('is-active', index === nearest);
      });
    }, 80);
  }, { passive: true });
}

function screenHead(title, description, actions = '') {
  return `<header class="screen-head"><div><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="button-row">${actions}</div>` : ''}</header>`;
}

function getGreetingText() {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

function showSearchShortcuts() {
  openModal('Quick Services', `
    <div class="grid grid--2" style="gap:12px; margin-top:8px;">
      <button class="card card--compact card--hover" type="button" data-screen="book" data-action-payload='{"bookingStep":1}'>
        <i data-lucide="ticket-plus" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Book Entebbe to Kampala</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="book" data-action-payload='{"bookingStep":1}'>
        <i data-lucide="ticket-plus" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Book Kampala to Entebbe</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="tickets">
        <i data-lucide="ticket" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">My Tickets &amp; Passes</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="book">
        <i data-lucide="search" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Find a departure</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="tracking">
        <i data-lucide="navigation" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Track my vehicle</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="parcel">
        <i data-lucide="package-plus" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Send a parcel</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="trackparcel-list">
        <i data-lucide="package" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Track a parcel</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="luggage">
        <i data-lucide="luggage" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Register luggage</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="wallet">
        <i data-lucide="wallet-cards" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">Open wallet</strong>
      </button>
      <button class="card card--compact card--hover" type="button" data-screen="returns">
        <i data-lucide="refresh-cw" style="color:var(--brand-blue)"></i>
        <strong style="display:block;margin-top:8px;font-size:0.85rem">View return tickets</strong>
      </button>
    </div>
  `, `<button class="button button--ghost" type="button" data-action="close-modal">Close</button>`);
}


// ==========================================================================
// Login Logs View Screen
// ==========================================================================
function renderLoginLogsScreen() {
  const logs = getLoginLogs();
  const filter = state.logFilter || 'all';
  const query = (state.logSearchQuery || '').toLowerCase().trim();

  const totalCount = logs.length;
  const successCount = logs.filter(l => l.status === 'SUCCESS').length;
  const failedCount = logs.filter(l => l.status === 'FAILED').length;

  let filteredLogs = logs;
  if (filter === 'success') {
    filteredLogs = filteredLogs.filter(l => l.status === 'SUCCESS');
  } else if (filter === 'failed') {
    filteredLogs = filteredLogs.filter(l => l.status === 'FAILED');
  }

  if (query) {
    filteredLogs = filteredLogs.filter(l => 
      (l.username && l.username.toLowerCase().includes(query)) ||
      (l.reason && l.reason.toLowerCase().includes(query)) ||
      (l.device && l.device.toLowerCase().includes(query)) ||
      (l.dateFormatted && l.dateFormatted.toLowerCase().includes(query)) ||
      (l.id && l.id.toLowerCase().includes(query))
    );
  }

  const session = getAuthSession();
  const currentUser = session ? session.name || session.username : (state.userName || 'Administrator');
  const currentLoginTime = session?.loginDisplayTime || state.lastLoginTime || 'Active session';

  return `
    ${screenHead('Access & Login Logs', 'Real-time audit record of all authentication attempts with exact timestamp, username, and device information.')}

    <div class="login-logs-container">
      <div class="log-stats-grid">
        <div class="log-stat-card">
          <div class="log-stat-icon log-stat-icon--primary">
            <i data-lucide="history"></i>
          </div>
          <div class="log-stat-data">
            <span class="log-stat-label">Total Logged Events</span>
            <strong class="log-stat-val">${totalCount}</strong>
            <small class="log-stat-sub">Audit trail records</small>
          </div>
        </div>

        <div class="log-stat-card">
          <div class="log-stat-icon log-stat-icon--success">
            <i data-lucide="shield-check"></i>
          </div>
          <div class="log-stat-data">
            <span class="log-stat-label">Successful Logins</span>
            <strong class="log-stat-val text-success">${successCount}</strong>
            <small class="log-stat-sub">Verified sessions</small>
          </div>
        </div>

        <div class="log-stat-card">
          <div class="log-stat-icon log-stat-icon--danger">
            <i data-lucide="shield-alert"></i>
          </div>
          <div class="log-stat-data">
            <span class="log-stat-label">Failed Attempts</span>
            <strong class="log-stat-val text-danger">${failedCount}</strong>
            <small class="log-stat-sub">Rejected credentials</small>
          </div>
        </div>

        <div class="log-stat-card">
          <div class="log-stat-icon log-stat-icon--gold">
            <i data-lucide="user-check"></i>
          </div>
          <div class="log-stat-data">
            <span class="log-stat-label">Active Session</span>
            <strong class="log-stat-val log-stat-val--user">${escapeHtml(currentUser)}</strong>
            <small class="log-stat-sub">Logged in: ${escapeHtml(currentLoginTime)}</small>
          </div>
        </div>
      </div>

      <div class="log-toolbar-card card">
        <div class="log-toolbar-row">
          <div class="log-search-wrap">
            <i data-lucide="search" class="log-search-icon"></i>
            <input 
              id="log-search-input" 
              type="search" 
              class="log-search-input" 
              placeholder="Search by username, date, device..." 
              value="${escapeHtml(state.logSearchQuery || '')}"
              oninput="handleLogSearch(this.value)"
            >
          </div>

          <div class="log-filter-pills">
            <button type="button" class="log-pill ${filter === 'all' ? 'is-active' : ''}" data-action="filter-logs" data-value="all">
              All (${totalCount})
            </button>
            <button type="button" class="log-pill ${filter === 'success' ? 'is-active' : ''}" data-action="filter-logs" data-value="success">
              <span class="dot--success"></span> Success (${successCount})
            </button>
            <button type="button" class="log-pill ${filter === 'failed' ? 'is-active' : ''}" data-action="filter-logs" data-value="failed">
              <span class="dot--danger"></span> Failed (${failedCount})
            </button>
          </div>

          <div class="log-actions-group">
            <button type="button" class="button button--secondary button--small" data-action="export-logs-csv" title="Download CSV spreadsheet">
              <i data-lucide="file-spreadsheet"></i> <span>Export CSV</span>
            </button>
            <button type="button" class="button button--secondary button--small" data-action="export-logs-json" title="Download raw JSON">
              <i data-lucide="download"></i> <span>Export JSON</span>
            </button>
            <button type="button" class="button button--primary button--small" data-action="simulate-login-test" title="Add simulated live event">
              <i data-lucide="plus-circle"></i> <span>Simulate Event</span>
            </button>
            <button type="button" class="button button--ghost button--small text-danger" data-action="clear-login-logs" title="Reset logs">
              <i data-lucide="trash-2"></i> <span>Clear</span>
            </button>
          </div>
        </div>
      </div>

      <article class="card log-table-card">
        <div class="card-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h2 style="font-size:1.15rem; margin:0; display:flex; align-items:center; gap:8px;">
              <i data-lucide="shield-check" style="color:var(--brand-blue);"></i> Recorded Authentication Timeline
            </h2>
            <p class="muted text-small" style="margin:4px 0 0;">Showing ${filteredLogs.length} of ${totalCount} records (persisted locally per timestamp)</p>
          </div>
          <span class="status-chip status-chip--success" style="font-size:0.75rem;">
            <i data-lucide="activity" style="width:12px; height:12px;"></i> Live Monitoring Active
          </span>
        </div>

        ${filteredLogs.length === 0 ? `
          <div class="empty-log-state">
            <div class="empty-log-icon"><i data-lucide="shield"></i></div>
            <h3>No logs matching your filter</h3>
            <p class="muted">Try clearing your search query or switching tabs.</p>
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table log-data-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Timestamp (Time & Date)</th>
                  <th scope="col">Username</th>
                  <th scope="col">Activity & Reason</th>
                  <th scope="col">Device / Client</th>
                  <th scope="col">Origin / IP</th>
                  <th scope="col">Log ID</th>
                </tr>
              </thead>
              <tbody>
                ${filteredLogs.map(log => {
                  const isSuccess = log.status === 'SUCCESS';
                  const isFailed = log.status === 'FAILED';
                  const badgeClass = isSuccess ? 'log-badge--success' : (isFailed ? 'log-badge--danger' : 'log-badge--neutral');
                  const badgeIcon = isSuccess ? 'check-circle' : (isFailed ? 'alert-triangle' : 'log-out');
                  const badgeText = isSuccess ? 'SUCCESS' : (isFailed ? 'FAILED' : (log.status || 'EVENT'));

                  return `
                    <tr class="log-row ${isFailed ? 'log-row--failed' : ''}">
                      <td>
                        <span class="log-badge ${badgeClass}">
                          <i data-lucide="${badgeIcon}"></i>
                          <span>${badgeText}</span>
                        </span>
                      </td>
                      <td>
                        <div class="log-time-cell">
                          <strong>${escapeHtml(log.dateFormatted || log.timestamp)}</strong>
                          <span class="log-rel-time">${formatRelativeTime(log.timestamp)}</span>
                        </div>
                      </td>
                      <td>
                        <div class="log-user-cell">
                          <span class="log-user-avatar"><i data-lucide="user"></i></span>
                          <span class="log-user-name">${escapeHtml(log.username)}</span>
                        </div>
                      </td>
                      <td>
                        <span class="log-reason-text">${escapeHtml(log.reason || 'Authentication verified')}</span>
                      </td>
                      <td>
                        <span class="log-device-badge">
                          <i data-lucide="${(log.device || '').toLowerCase().includes('mobile') ? 'smartphone' : 'monitor'}"></i>
                          <span>${escapeHtml(log.device || 'Web Browser')}</span>
                        </span>
                      </td>
                      <td>
                        <span class="log-ip-badge">${escapeHtml(log.ip || '127.0.0.1 (Direct)')}</span>
                      </td>
                      <td>
                        <code class="log-id-code">${escapeHtml(log.id || '-')}</code>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </article>
    </div>
  `;
}


function renderHome() {
  const greeting = getGreetingText();
  const departures = appData.trips.slice(0, 4).map((trip) => {
    let badgeClass = 'is-available';
    if (trip.status === 'Almost full') {
      badgeClass = 'is-warning';
    } else if (trip.status === 'Full') {
      badgeClass = 'is-danger';
    }

    return {
      ...trip,
      origin: trip.boarding,
      dest: trip.destination,
      time: trip.depart,
      arrival: trip.arrive,
      spaces: trip.seats,
      badge: trip.status === 'Almost full' ? 'Almost full' : `${trip.seats} spaces available`,
      badgeClass: badgeClass,
      price: formatUGX(trip.fare),
      traffic: `${trip.traffic} traffic`
    };
  });

  const upcomingTrip = state.activeTrip || appData.trips[0];
  const upcomingBoarding = upcomingTrip.boarding;
  const upcomingDest = upcomingTrip.destination;
  const upcomingDepart = upcomingTrip.depart;

  return `
    <div class="home-redesign app fade-in-up">
      <div class="layout">
        <div class="main-column">
          <!-- 2. HOME GREETING SECTION -->
          <div class="home-greeting-card" style="margin-bottom: 22px; animation: enter .45s var(--ease) both; text-align: left;">
            <small style="text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.06em; color: var(--muted); font-weight: 750; display: block;">Hi ${escapeHtml(state.passengerDetails[0]?.name.split(' ')[0] || 'Christo')}</small>
            <h1 id="timeGreeting" style="font-size: clamp(1.8rem, 6.5vw, 2.2rem); font-weight: 850; color: var(--brand-blue-dark); margin: 3px 0 1px; letter-spacing: -0.025em; line-height: 1.15;">${greeting}</h1>
            <p style="color: var(--slate); font-size: 0.92rem; margin: 0; opacity: 0.88;">Where would you like to travel today?</p>
          </div>

          <!-- 3. SEARCH AND FILTER ROW -->
          <form class="search-row" onsubmit="event.preventDefault(); handleSearchSubmit(this.querySelector('.search-input').value);">
            <div style="position: relative; display: flex; align-items: center; min-width: 0;">
              <svg style="position: absolute; left: 17px; width: 20px; height: 20px; color: var(--blue-800); pointer-events: none; z-index: 5;"><use href="#i-search"></use></svg>
              <input class="search-input" type="text" placeholder="Search route, stage or service..." style="width: 100%; min-height: 58px; border: 0; border-radius: 19px; background: rgba(255,255,255,.92); box-shadow: var(--shadow-sm); padding: 0 17px 0 48px; color: var(--ink); font-weight: 650; outline: none; transition: transform var(--ease), box-shadow var(--ease); font-size: 15px;" value="${escapeHtml(state.homeSearchQuery || '')}" />
            </div>
            <button class="filter-button" type="button" data-action="show-search-filters" aria-label="Open trip filters" aria-haspopup="dialog" style="cursor: pointer;">
              <svg style="width: 20px; height: 20px;"><use href="#i-sliders"></use></svg>
            </button>
          </form>

          <!-- 5. POPULAR SERVICES SECTION -->
          <section class="section" style="animation-delay:.10s" aria-labelledby="servicesTitle">
            <div class="section-head"><h2 id="servicesTitle">Popular services</h2><button class="text-button" type="button" data-action="open-search-shortcuts">Show all</button></div>
            <div class="services-scroll">
              <button class="service" type="button" data-screen="book" data-action-payload='{"bookingStep":1}'><span class="service-icon"><svg><use href="#i-ticket"></use></svg></span><span>Book Travel</span></button>
              <button class="service" type="button" data-screen="tickets"><span class="service-icon"><i data-lucide="ticket" style="width: 22px; height: 22px; color: var(--brand-blue);"></i></span><span>My Tickets</span></button>
              <button class="service" type="button" data-screen="tracking"><span class="service-icon"><i data-lucide="navigation" style="width: 22px; height: 22px; color: var(--brand-blue);"></i></span><span>Track a Travel</span></button>
              <button class="service" type="button" data-screen="returns"><span class="service-icon"><svg><use href="#i-return"></use></svg></span><span>Return Ticket</span></button>
              <button class="service" type="button" data-screen="parcel"><span class="service-icon"><svg><use href="#i-package"></use></svg></span><span>Send Parcel</span></button>
              <button class="service" type="button" data-screen="wallet"><span class="service-icon"><svg><use href="#i-wallet"></use></svg></span><span>Wallet</span></button>
            </div>
          </section>

          <!-- 6. DEPARTURES CAROUSEL -->
          <section class="section" style="animation-delay:.15s" aria-labelledby="departuresTitle">
            <div class="section-head">
              <h2 id="departuresTitle">Departures</h2>
              <button class="text-button" type="button" data-screen="available-vans">Show all</button>
            </div>
            
            <div class="departure-scroll" id="departureCarousel">
              ${departures.map((dep, index) => {
                const isSaved = state.savedDepartures && state.savedDepartures.includes(dep.id);
                
                const isWarning = dep.spaces <= 2;
                
                return `
                <article class="departure-card" data-card-index="${index}">
                  <div class="departure-visual departure-visual--photo">
                    <img src="${dep.img}" alt="${dep.driverName}" class="departure-visual__thumb" />
                    <div class="departure-visual__overlay"></div>
                    <span class="visual-label">${dep.vehicle} · ${dep.countdown}</span>
                    <button class="save-button ${isSaved ? 'is-saved' : ''}" type="button" data-action="toggle-save-departure" data-dep-id="${dep.id}" aria-label="Save ${dep.time} departure">
                      <svg><use href="${isSaved ? '#i-heart-fill' : '#i-heart'}"></use></svg>
                    </button>
                  </div>
                  <div class="departure-body">
                    <div class="departure-title-row">
                      <div>
                        <h3 style="margin: 0 0 4px 0;">${dep.origin.split(' ')[0]} → ${dep.dest.split(' ')[0]}</h3>
                      </div>
                      <span class="capacity-chip ${isWarning ? 'warning' : ''}">${dep.spaces} space${dep.spaces === 1 ? '' : 's'}</span>
                    </div>

                    <!-- Proximity / Stage Row -->
                    <div class="taxi-proximity-row" style="display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--muted); margin-top: 6px; margin-bottom: 12px;">
                      <span style="display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="clock" style="width: 12px; height: 12px;"></i> ${dep.countdown}</span>
                      <span>·</span>
                      <span style="display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="map-pin" style="width: 12px; height: 12px;"></i> ${dep.currentStage}</span>
                    </div>

                    <div class="departure-times">
                      <div class="time"><strong>${dep.time}</strong><span>Departure</span></div>
                      <div class="time-line"></div>
                      <div class="time"><strong>${dep.arrival}</strong><span>Arrival</span></div>
                    </div>
                    <div class="departure-foot">
                      <div class="fare"><small>Starting from</small><strong>${dep.price}</strong></div>
                      <button class="select-button" type="button" data-action="select-departure" data-trip="${dep.time}">Select Travel</button>
                    </div>
                  </div>
                </article>
                `;
              }).join('')}
            </div>
            <div class="carousel-dots">
              ${departures.map((_, i) => `<button class="carousel-dot ${i === 0 ? 'is-active' : ''}" type="button" data-dot="${i}" aria-label="Slide ${i + 1}"></button>`).join('')}
            </div>
          </section>

          <!-- 7. SAVE-WITH-RETURN-TICKET FEATURE CARD -->
          <section class="card offer-card section" style="animation-delay:.24s">
            <span class="offer-label"><svg width="15" height="15"><use href="#i-return"></use></svg>Save UGX 1,000</span>
            <h2>Travel to Kampala and secure your return for less.</h2>
            <p>Buy both journeys together and use the return on an eligible departure before it expires.</p>
            <div class="offer-prices">
              <div class="offer-price"><small>Outbound</small><strong>UGX 5,000</strong></div>
              <div class="offer-price"><small>Return</small><strong>UGX 4,000</strong></div>
              <div class="offer-price"><small>Package total</small><strong>UGX 9,000</strong></div>
            </div>
            <button class="primary-button" type="button" data-screen="returns">Get Return Ticket <svg><use href="#i-arrow"></use></svg></button>
          </section>
        </div>

        <!-- SIDE COLUMN -->
        <aside class="side-column">
          <!-- 8. UPCOMING TRIP CARD -->
          <section class="card compact-card section" style="animation-delay:.14s">
            <div class="compact-head"><div><h3>Upcoming travel</h3><p>Today · ${upcomingBoarding.split(' ')[0]} to ${upcomingDest.split(' ')[0]}</p></div><span class="status-chip">Confirmed</span></div>
            <div class="trip-detail-grid">
              <div class="detail-box"><small>Boarding</small><strong>8:15 AM</strong></div>
              <div class="detail-box"><small>Departure</small><strong id="upcomingTime">${upcomingDepart}</strong></div>
              <div class="detail-box"><small>Vehicle</small><strong>${upcomingTrip.plate}</strong></div>
              <div class="detail-box"><small>Capacity</small><strong>Seat position 04</strong></div>
            </div>
            <div class="compact-actions">
              <button class="compact-action primary" type="button" data-screen="ticket">View Ticket</button>
              <button class="compact-action" type="button" data-screen="tracking">Track Vehicle</button>
            </div>
          </section>

          <!-- 9. WALLET CARD -->
          <section class="card wallet-card section" style="animation-delay:.18s">
            <small>Taxibee Wallet</small>
            <div class="wallet-balance">${formatUGX(state.walletBalance)}</div>
            <p class="wallet-credit">UGX 2,000 promotional credit available</p>
            <div class="wallet-actions">
              <button class="wallet-action" type="button" data-action="open-add-funds">Add Funds</button>
              <button class="wallet-action" type="button" data-screen="wallet">Transactions</button>
            </div>
          </section>

          <!-- 10. ACTIVE PARCEL CARD -->
          <section class="card compact-card section" style="animation-delay:.22s">
            <div class="compact-head"><div><h3>Active parcel</h3><p>FXP-260718-0842</p></div><span class="status-chip info">In Transit</span></div>
            <div class="parcel-progress">
              <div class="parcel-progress-row"><span>Entebbe</span><strong>66%</strong><span>Kampala</span></div>
              <div class="progress-track"><span></span></div>
            </div>
            <div class="trip-detail-grid">
              <div class="detail-box"><small>Estimated arrival</small><strong>10:45 AM</strong></div>
              <div class="detail-box"><small>Vehicle</small><strong>UBP 318F</strong></div>
            </div>
            <button class="compact-action primary" style="width:100%" type="button" data-screen="trackparcel">Track Parcel</button>
          </section>
        </aside>
      </div>

      <!-- Notice Panel -->
      <div class="notice" style="margin-top:20px"><i data-lucide="triangle-alert"></i><div><strong>Service notice</strong><div>Morning traffic is heavier than usual. Estimated journey times may increase by 15 minutes.</div></div></div>
    </div>
  `;
}

function quickAction(label, icon, screen, action = '') {
  return `<button class="quick-action" type="button" ${action ? `data-action="${action}"` : `data-screen="${screen}"`}><span class="quick-action__icon"><i data-lucide="${icon}"></i></span><span>${label}</span></button>`;
}

function departureRow(time, seats, width, label) {
  return `<div class="departure-row"><span class="departure-time">${time}</span><div><div class="availability-bar"><span style="width:${width}%"></span></div><small class="muted">${label}</small></div><button class="button button--ghost button--tiny" type="button" data-action="select-departure" data-trip="${time}">Select</button></div>`;
}

function renderBook() {
  const step = state.bookingStep || 1;

  if (step === 1) {
    return `
      ${screenHead('Book for Later & Scheduled Travel', 'Schedule an advance journey for any upcoming date or time. Select your corridor, choose preferred vehicles & drivers, and configure real-time vehicle alerts.')}
      
      <div class="popular-places-column-layout" style="margin-top: 16px;">
        ${appData.routeCards.map(rc => {
          const flipState = state.routeFlips[rc.key];
          const flipped = !!flipState;
          const wasToggled = flipState !== undefined;
          const origin = flipped ? rc.cityB : rc.cityA;
          const dest = flipped ? rc.cityA : rc.cityB;
          const img = flipped ? rc.imageA : rc.imageB;
          const corridor = flipped ? rc.corridor.split(' • ').reverse().join(' • ') : rc.corridor;
          const isExpanded = state.selectedRoute === rc.key;

          return `
            <div class="popular-place-card ${isExpanded ? 'is-expanded' : ''}">
              
              <!-- Hero Photo Visual Area -->
              <div class="popular-place-hero" data-action="select-route-card-step" data-route="${rc.key}" role="button" tabindex="0" style="background-image: url('${img}');">
                <!-- Dark Overlay for Contrast -->
                <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.15) 100%); pointer-events: none;"></div>
                
                <!-- Top Row: Price Tag & Direction Swap Button -->
                <div style="position: relative; z-index: 5; display: flex; justify-content: space-between; align-items: center;">
                  <span style="background: rgba(255, 255, 255, 0.94); color: var(--brand-blue-dark); font-weight: 850; font-size: 0.85rem; padding: 6px 14px; border-radius: 12px; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                    ${rc.price}
                  </span>
                  <button class="route-card__flip-btn ${flipped ? 'is-flipped' : ''} ${wasToggled ? 'was-toggled' : ''}" type="button" data-action="flip-route-direction" data-route="${rc.key}" title="Swap direction" aria-label="Swap direction" style="position: absolute; top: 0px; right: 0px; z-index: 10; width: 38px; height: 38px; border-radius: 50%; background: rgba(0,0,0,0.55); color: white; border: 1px solid rgba(255,255,255,0.35); display: grid; place-items: center; cursor: pointer; backdrop-filter: blur(6px);">
                    <i data-lucide="arrow-down-up" style="width: 16px; height: 16px;"></i>
                  </button>
                </div>

                <!-- Bottom Row: Title & Subtitle -->
                <div style="position: relative; z-index: 5; text-align: left; color: white;">
                  <h3 style="margin: 0 0 4px 0; font-size: 1.45rem; font-weight: 850; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.4);">${dest}</h3>
                  <p style="margin: 0; font-size: 0.86rem; color: rgba(255,255,255,0.92); font-weight: 600; display: flex; align-items: center; gap: 4px;">
                    <i data-lucide="map-pin" style="width: 14px; height: 14px; color: #ffeb3b;"></i>
                    From ${origin} · ${rc.via}
                  </p>
                </div>
              </div>

              <!-- Revealed Cities & Action Drawer (Smooth accordion transition) -->
              <div class="popular-place-drawer">
                <div class="popular-place-details-inner">
                  <div style="font-size: 0.86rem; color: var(--charcoal); font-weight: 600; line-height: 1.5; background: var(--page); padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border);">
                    ${corridor}
                  </div>
                  <button class="button button--primary w-full" type="button" data-action="booking-next-step" style="padding: 12px; font-size: 0.95rem; font-weight: 800;">
                    Book Now →
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (step === 2) {
    const allowedFrom = appData.routes.filter(r => {
      if (state.selectedRoute === 'busega') return ['Entebbe Bus Park', 'Kampala Railway Stage'].includes(r);
      if (state.selectedRoute === 'nambole') return ['Entebbe Bus Park', 'Nambole'].includes(r);
      if (state.selectedRoute === 'masaka') return ['Entebbe Bus Park', 'Masaka'].includes(r);
      if (state.selectedRoute === 'lyantonde') return ['Entebbe Bus Park', 'Lyantonde'].includes(r);
      if (state.selectedRoute === 'mbarara') return ['Entebbe Bus Park', 'Mbarara'].includes(r);
      return ['Entebbe Bus Park', 'Kitooro', 'Abayita Ababiri', 'Kajjansi', 'Clock Tower', 'Kampala Railway Stage'].includes(r);
    });
    const allowedTo = allowedFrom;

    return `
      <div class="booking-map-wrapper">
        <div id="booking-step2-map" style="position: absolute; top: -60px; left: 0; width: 100%; height: calc(100% + 120px); z-index: 1;"></div>
        <div id="booking-step2-map-fallback" class="trip-map-fallback" style="background: #faf8ef; z-index: 2;" hidden>
          <img src="assets/taxibee-minivan-branded.png" alt="" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; margin-bottom: 8px;">
          <strong style="font-size: 0.95rem; color: var(--brand-blue-dark);">Preparing Route Map...</strong>
          <span style="font-size: 0.8rem; color: var(--muted);">Connecting to map tiles...</span>
        </div>
      </div>

      <section class="card booking-card-step2">
          <!-- Booking-for header banner -->
          <div class="booking-for-header ${state.isBookingForSomeoneElse ? 'is-other' : ''}">
            <div class="booking-for-header__top">
              <div class="booking-for-header__info">
                <div class="booking-for-header__icon">
                  <i data-lucide="${state.isBookingForSomeoneElse ? 'user-round-plus' : 'user-round-check'}" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                  <strong class="booking-for-header__title">${state.isBookingForSomeoneElse ? 'Booking for someone else' : 'Booking for yourself'}</strong>
                  <span class="booking-for-header__sub">${state.isBookingForSomeoneElse ? 'Enter traveler\'s details below' : `${escapeHtml(appData.passenger.name)} · ${escapeHtml(appData.passenger.phone)}`}</span>
                </div>
              </div>
              <button class="switch ${state.isBookingForSomeoneElse ? 'is-on' : ''}" type="button" data-action="toggle-book-for-someone-else" aria-label="Toggle booking for someone else"><span></span></button>
            </div>
            ${state.isBookingForSomeoneElse ? `
              <div class="booking-for-header__fields">
                <div class="field" style="margin: 0;">
                  <label for="other-traveler-name">Traveler's Full Name</label>
                  <input id="other-traveler-name" type="text" placeholder="e.g. John Doe" value="${escapeHtml(state.otherTravelerName)}" data-field="other-traveler-name">
                </div>
                <div class="field" style="margin: 0;">
                  <label for="other-traveler-phone">Traveler's Phone Number</label>
                  <input id="other-traveler-phone" type="tel" placeholder="e.g. +256 700 000 000" value="${escapeHtml(state.otherTravelerPhone)}" data-field="other-traveler-phone">
                </div>
              </div>
            ` : ''}
          </div>

          <div class="booking-step2-body">
            <div class="route-interchange-card">
              <div class="route-field-box">
                <label for="book-from">FROM</label>
                <select id="book-from" data-field="search-from">
                  ${allowedFrom.map(route => optionMarkup(route, state.searchFrom)).join('')}
                </select>
              </div>
              <button class="swap-button vertical-swap-btn" type="button" data-action="swap-route" aria-label="Swap locations">
                <i data-lucide="arrow-down-up" style="width: 18px; height: 18px; color: var(--brand-blue-dark);"></i>
              </button>
              <div class="route-field-box">
                <label for="book-to">TO</label>
                <select id="book-to" data-field="search-to">
                  ${allowedTo.map(route => optionMarkup(route, state.searchTo)).join('')}
                </select>
              </div>
            </div>
            
            <div class="form-grid form-grid--2" style="align-items: start;">
              <div class="field">
                <label>Travel date</label>
                <div class="choice-pills" style="margin-top: 4px; display: flex; gap: 8px;">
                  <button class="choice-pill ${state.dateSelectionMode === 'today' ? 'is-selected' : ''}" type="button" data-action="select-date-mode" data-value="today" style="flex: 1; text-align: center;">Today</button>
                  <button class="choice-pill ${state.dateSelectionMode === 'later' ? 'is-selected' : ''}" type="button" data-action="select-date-mode" data-value="later" style="flex: 1; text-align: center;">Later</button>
                </div>
                ${state.dateSelectionMode === 'later' ? `
                  <div style="margin-top: 8px;">
                    <label for="book-date" style="font-size: 0.75rem; font-weight: 700; color: var(--slate); display: block; margin-bottom: 4px;">Choose custom date</label>
                    <input id="book-date" type="date" value="${state.bookingDate}" data-field="booking-date" style="padding: 8px; border-radius: 8px; border: 1px solid var(--border); width: 100%;">
                  </div>
                ` : ''}
              </div>
              <div class="field"><label for="book-period">Preferred period</label><select id="book-period" data-field="search-period"><option value="" disabled ${!state.searchPeriod ? 'selected' : ''} hidden>Select</option>${['Morning','Afternoon','Evening'].map(period => optionMarkup(period, state.searchPeriod, `${period} · ${period === 'Morning' ? '5:00–11:59' : period === 'Afternoon' ? '12:00–4:59' : '5:00–10:00'}`)).join('')}</select></div>
            </div>

            <!-- Drop-off location along corridor -->
            <div class="field" style="text-align: left; width: 100%;">
              <label for="book-drop-off">Preferred drop-off point</label>
              <select id="book-drop-off" data-field="drop-off-location" style="width: 100%;">
                <option value="" disabled ${!state.dropOffLocation ? 'selected' : ''} hidden>Select</option>
                ${getDropOffOptions().map(stage => optionMarkup(stage, state.dropOffLocation, stage === state.searchTo ? `${stage} (Final destination)` : stage)).join('')}
                <option value="__other__" ${state.dropOffLocation === '__other__' ? 'selected' : ''}>Other – type your own</option>
              </select>
            </div>

            <!-- Custom drop-off free-text field (shown when Other is selected) -->
            ${state.dropOffLocation === '__other__' ? `
            <div class="field" style="text-align: left; width: 100%; margin-top: -8px; animation: slideDown 0.2s ease;">
              <label for="book-drop-off-custom" style="display: flex; align-items: center; gap: 6px;">
                <i data-lucide="map-pin" style="width: 13px; height: 13px; color: var(--brand-blue);"></i>
                Specify your drop-off point
              </label>
              <input
                id="book-drop-off-custom"
                type="text"
                data-field="custom-drop-off"
                placeholder="e.g. Shell Petrol Station, Jinja Road"
                value="${state.customDropOff || ''}"
                style="width: 100%;"
              >
              <span class="field-help">Enter a landmark, stage, or address near your destination.</span>
            </div>` : ''}

            <!-- Modern side-by-side (stacked on mobile) Adults & Children steppers -->
            <div class="steppers-row">
              
              <!-- Adults Card -->
              <div class="stepper-card" style="flex: 1; background: #f1eee4; border: 1px solid #f1eee4; border-radius: 16px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
                <div style="text-align: left;">
                  <strong style="font-size: 0.9rem; display: block; color: var(--charcoal);">Adults</strong>
                  <span class="muted text-small" style="font-size: 0.72rem; display: block; margin-top: 2px;">12+ years</span>
                </div>
                <div class="stepper-controls" style="display: flex; align-items: center; gap: 12px;">
                  <button type="button" class="stepper-btn" data-action="decrement-adults" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: white; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: var(--brand-blue); box-shadow: var(--shadow-xs); transition: all 0.2s;">-</button>
                  <span id="adult-count-display" style="width: 20px; text-align: center; font-weight: 800; font-size: 1.15rem; color: var(--charcoal);">${state.passengerCount}</span>
                  <button type="button" class="stepper-btn" data-action="increment-adults" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: white; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: var(--brand-blue); box-shadow: var(--shadow-xs); transition: all 0.2s;">+</button>
                </div>
              </div>

              <!-- Children Card -->
              <div class="stepper-card" style="flex: 1; background: #f1eee4; border: 1px solid #f1eee4; border-radius: 16px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
                <div style="text-align: left;">
                  <strong style="font-size: 0.9rem; display: block; color: var(--charcoal);">Children</strong>
                  <span class="muted text-small" style="font-size: 0.72rem; display: block; margin-top: 2px;">Under 12</span>
                </div>
                <div class="stepper-controls" style="display: flex; align-items: center; gap: 12px;">
                  <button type="button" class="stepper-btn" data-action="decrement-children" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: white; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: var(--brand-blue); box-shadow: var(--shadow-xs); transition: all 0.2s;">-</button>
                  <span id="child-count-display" style="width: 20px; text-align: center; font-weight: 800; font-size: 1.15rem; color: var(--charcoal);">${state.childCount}</span>
                  <button type="button" class="stepper-btn" data-action="increment-children" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: white; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: var(--brand-blue); box-shadow: var(--shadow-xs); transition: all 0.2s;">+</button>
                </div>
              </div>

            </div>

            <!-- Reserved Child Seats Stepper Card (Only shown if children added) -->
            ${state.childCount > 0 ? `
              <div>
                <div class="stepper-card" style="background: #f1eee4; border: 1px solid #f1eee4; border-radius: 16px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; width: 100%;">
                  <div style="text-align: left;">
                    <strong style="font-size: 0.95rem; display: block; color: var(--charcoal);">Reserved Child Seats</strong>
                    <span class="muted text-small" style="font-size: 0.76rem; display: block; margin-top: 2px;">Lap travel is free. Reserving a seat adds normal fare (${formatUGX(state.ticketType === 'return' ? 9000 : 5000)} / child)</span>
                  </div>
                  <div class="stepper-controls" style="display: flex; align-items: center; gap: 14px;">
                    <button type="button" class="stepper-btn" data-action="decrement-child-seats" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: white; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; color: var(--brand-blue); box-shadow: var(--shadow-xs); transition: all 0.2s;">-</button>
                    <span id="child-seats-display" style="width: 20px; text-align: center; font-weight: 800; font-size: 1.2rem; color: var(--charcoal);">${state.reservedChildSeatsCount}</span>
                    <button type="button" class="stepper-btn" data-action="increment-child-seats" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: white; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; color: var(--brand-blue); box-shadow: var(--shadow-xs); transition: all 0.2s;">+</button>
                  </div>
                </div>
              </div>
            ` : ''}

            <!-- Advance Travel Notifications Section -->
            <div style="background: var(--surface-alt); border: 1px solid var(--border); border-radius: 16px; padding: 14px 18px; text-align: left;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <i data-lucide="bell" style="width: 18px; height: 18px; color: var(--brand-blue);"></i>
                <strong style="font-size: 0.9rem; color: var(--brand-blue-dark);">Advance Travel Alert Preferences</strong>
              </div>
              <p style="font-size: 0.8rem; color: var(--slate); margin: 0 0 10px 0; line-height: 1.4;">
                Since you are scheduling for later, get automated SMS &amp; app alerts as your vehicle enters stage:
              </p>
              <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.82rem;">
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 600; color: var(--charcoal);">
                  <input type="checkbox" checked> Alert me when my vehicle becomes active on stage
                </label>
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 600; color: var(--charcoal);">
                  <input type="checkbox" checked> Alert me 15 minutes before scheduled departure
                </label>
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 600; color: var(--charcoal);">
                  <input type="checkbox" checked> Alert me if driver goes off-road or changes timeline
                </label>
              </div>
            </div>

            <div class="button-row" style="margin-top: 8px;">
              <button class="button button--ghost" type="button" data-action="booking-prev-step" aria-label="Go back" style="padding: 0; min-width: 28px; flex: 0 0 28px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; box-shadow: none; margin-right: 4px;"><i data-lucide="chevron-left" style="width: 24px; height: 24px; color: var(--brand-blue);"></i></button>
              <button class="button button--primary" style="flex: 1;" type="button" data-action="booking-next-step">Search Vehicles</button>
            </div>
          </div>
        </section>
    `;
  }

  if (step === 3) {
    // If selected trip no longer has enough seats, clear selection
    if (state.activeTrip) {
      const liveTrip = appData.trips.find(t => t.id === state.activeTrip.id);
      if (liveTrip && liveTrip.seats < passengerTotal()) {
        state.activeTrip = null;
      }
    }

    const results = getSearchResults();
    const sortedTrips = results.slice().sort((a, b) => {
      const getMins = (str) => {
        const match = str.match(/\d+/);
        return match ? parseInt(match[0], 10) : 999;
      };
      return getMins(a.countdown) - getMins(b.countdown);
    });

    return `
      ${screenHead('Available Vehicles', 'Select your preferred transit vehicle from active departures.')}

      <div class="booking-desktop-split booking-desktop-split--60-40" style="margin-top: 16px;">
        <section class="taxi-results-grid">
          ${sortedTrips.length ? sortedTrips.map(trip => {
            const isSelected = state.activeTrip && state.activeTrip.id === trip.id;
            const hasEnoughSeats = trip.seats >= passengerTotal();
            const capacity = getVehicleCapacity(trip);
            return `
              <article class="card card--hover result-card taxi-result-card ${isSelected ? 'is-active' : ''} ${!hasEnoughSeats ? 'is-disabled' : ''}" data-action="${hasEnoughSeats ? 'select-booking-vehicle' : ''}" data-trip-id="${trip.id}" role="button" tabindex="${hasEnoughSeats ? '0' : '-1'}" style="${isSelected ? 'border-color: var(--brand-blue); background: var(--info-soft); margin: 0; position: relative;' : 'margin: 0; position: relative;'} ${!hasEnoughSeats ? 'opacity: 0.55; cursor: not-allowed;' : ''}">
                ${hasEnoughSeats ? `<div class="card-selection-indicator ${isSelected ? 'is-selected' : ''}"></div>` : ''}
                
                <div class="taxi-card-main-layout">
                  <!-- LEFT COLUMN -->
                  <div class="taxi-card-left-col">
                    <span class="taxi-van-type-label">${trip.vehicle}</span>
                    <div class="taxi-van-img-wrapper">
                      <div class="taxi-van-img-box">
                        <img src="${getTripVehicleImage(trip.vehicle)}" alt="Taxibee Vehicle" class="${!hasEnoughSeats ? 'is-grayscale' : ''}">
                      </div>
                      <!-- Ugandan Plate -->
                      <div class="ug-plate-badge">
                        <div class="ug-flag-strip"></div>
                        <div class="ug-plate-number">${trip.plate}</div>
                      </div>
                    </div>
                  </div>
                  
                  <!-- RIGHT COLUMN -->
                  <div class="taxi-card-right-col">
                    <!-- Clickable Driver Card Shape -->
                    ${(() => {
                      const dObj = driversData[trip.driverName.toLowerCase()] || {};
                      const avatarUrl = dObj.avatar || 'assets/driver_1-branded.png';
                      return `
                        <div class="taxi-driver-row" onclick="event.stopPropagation(); showDriverProfileModal('${trip.driverName.toLowerCase()}');" title="View driver details">
                          <div class="driver-circle-avatar" style="overflow: hidden; border-radius: 50%;">
                            <img src="${avatarUrl}" alt="${trip.driverName}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
                          </div>
                          <div class="driver-text-block">
                            <div class="driver-name-tag-row" style="display: flex; align-items: center; gap: 6px;">
                              <strong class="driver-name-text">${trip.driverName}</strong>
                              <span class="driver-subtext-pill">Driver</span>
                            </div>
                            <div class="driver-rating-row" style="margin-top: 3px;">
                              <span class="driver-rating-badge"><i data-lucide="star" style="width: 11px; height: 11px; fill: #f59e0b; color: #f59e0b;"></i> ${trip.driverRating} Rating</span>
                            </div>
                          </div>
                        </div>
                      `;
                    })()}
                    
                    <!-- Desktop-only Bottom Group -->
                    <div class="taxi-desktop-divider-group" style="margin-top: 10px;">
                      <div class="taxi-card-dotted-divider"></div>
                      <div class="taxi-desktop-bottom-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                        <span class="taxi-duration-text" style="font-size: 0.8rem; color: var(--slate); font-weight: 600;"><i data-lucide="clock" style="width: 13px; height: 13px; vertical-align: middle; margin-right: 3px; color: var(--brand-blue);"></i> Travel time: ${trip.duration}</span>
                        <div class="taxi-seats-left-wrapper">
                          ${hasEnoughSeats ? `
                            <span class="status-chip ${trip.seats <= 2 ? 'status-chip--warning' : 'status-chip--success'}">${trip.seats} seats left</span>
                          ` : `
                            <span class="status-chip status-chip--danger">Only ${trip.seats} left (Need ${passengerTotal()})</span>
                          `}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- MOBILE-ONLY BOTTOM GROUP -->
                <div class="taxi-mobile-bottom-group">
                  <div class="taxi-card-dotted-divider-full"></div>
                  <div class="taxi-mobile-bottom-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                    <span class="taxi-duration-text-mobile" style="font-size: 0.78rem; color: var(--slate); font-weight: 600;"><i data-lucide="clock" style="width: 12px; height: 12px; vertical-align: middle; margin-right: 3px; color: var(--brand-blue);"></i> Travel time: ${trip.duration}</span>
                    <div class="taxi-seats-left-wrapper-mobile">
                      ${hasEnoughSeats ? `
                        <span class="status-chip ${trip.seats <= 2 ? 'status-chip--warning' : 'status-chip--success'}">${trip.seats} seats left</span>
                      ` : `
                        <span class="status-chip status-chip--danger">Only ${trip.seats} left</span>
                      `}
                    </div>
                  </div>
                </div>
              </article>
            `;
          }).join('') : emptyState('calendar-x-2','No departures found','Try setting a different period or stage.')}
        </section>

        <div class="taxi-selected-vehicle-card-wrapper">
          ${state.activeTrip ? `
            <div class="card" style="border: 1px solid rgba(26,26,26, 0.22); background: var(--info-soft); padding: 24px; border-radius: 16px; margin: 0; text-align: left;">
              <p class="section-kicker" style="margin: 0 0 4px 0;">Selected Vehicle</p>
              <h3 style="margin: 0 0 16px 0; font-size: 1.2rem; font-weight: 750; color: var(--charcoal);">${state.activeTrip.plate}</h3>
              
              <div class="detail-list">
                <div class="detail-row"><span>Driver</span><strong>${state.activeTrip.driverName} (${state.activeTrip.driverRating} ★)</strong></div>
                <div class="detail-row"><span>Departure Time</span><strong>${state.activeTrip.depart}</strong></div>
                <div class="detail-row"><span>Route Stage</span><strong>${state.activeTrip.currentStage}</strong></div>
                <div class="detail-row"><span>Available Seats</span><strong>${state.activeTrip.seats} spaces left</strong></div>
              </div>
            </div>
          ` : `
            <div class="card" style="border: 1px dashed var(--border); text-align: center; padding: 32px 16px; border-radius: 16px; margin: 0; display: grid; place-items: center; min-height: 180px;">
              <div>
                <i data-lucide="info" style="width: 32px; height: 32px; color: var(--brand-blue); margin-bottom: 12px; margin-left: auto; margin-right: auto;"></i>
                <strong style="display: block; font-size: 0.95rem; color: var(--charcoal);">No vehicle selected yet</strong>
                <p class="muted" style="font-size: 0.78rem; margin: 6px 0 0 0;">Select an available vehicle on the left to configure seat allocation options.</p>
              </div>
            </div>
          `}
        </div>
      </div>

      <div class="floating-cta-container button-row" style="margin-top: 24px;">
        <button class="button button--ghost" type="button" data-action="booking-prev-step" aria-label="Go back" style="padding: 0; min-width: 28px; flex: 0 0 28px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; box-shadow: none; margin-right: 4px;"><i data-lucide="chevron-left" style="width: 24px; height: 24px; color: var(--brand-blue);"></i></button>
        ${state.activeTrip ? `
          <button class="button button--secondary" type="button" data-action="book-preferred-seat" style="flex: 1; font-weight: 750;">Select Seat</button>
          <button class="button button--primary" type="button" data-action="booking-skip-seat" style="flex: 1; display: flex; flex-direction: column; align-items: center; line-height: 1; justify-content: center; height: 48px; gap: 0; padding: 4px 12px;">
            <span style="font-weight: 750; font-size: 0.9rem;">Proceed</span>
            <span style="font-size: 0.6rem; font-weight: 400; opacity: 0.8; display: block; white-space: nowrap; margin-top: -1px;">best available seat</span>
          </button>
        ` : `
          <button class="button button--primary" style="flex: 1; opacity: 0.6; cursor: not-allowed;" type="button" disabled>Select a Vehicle to Proceed</button>
        `}
      </div>
    `;
  }

  if (step === '3b') {
    const required = passengerTotal();
    return `
      ${screenHead('Select Preferred Seat', 'Choose your seat number in the passenger vehicle layout.')}

      <div class="booking-desktop-split" style="margin-top: 16px;">
        <section class="card" style="margin: 0; text-align: center; padding: 20px;">
          ${renderSeatMode()}
        </section>

        <section class="card" style="margin: 0; display: flex; flex-direction: column; justify-content: center; text-align: left; padding: 24px;">
          <p class="section-kicker">Seat Booking Info</p>
          <h2 style="margin: 0 0 12px 0;">Seat Selection</h2>
          <p class="muted" style="font-size: 0.85rem; line-height: 1.5; margin-bottom: 20px;">
            Choose preferred seats from the vehicle layout. Seat availability is updated in real time based on active stage occupancy.
          </p>
          <div style="background: var(--surface-alt); padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
            <strong style="font-size: 0.9rem; display: block; color: var(--charcoal);">Selection status</strong>
            <span class="status-chip status-chip--info" style="margin-top: 8px; display: inline-block;">${state.selectedSeats.length} of ${required} seats selected</span>
            ${state.selectedSeats.length > 0 ? `
              <div style="margin-top: 12px; font-size: 0.85rem;">
                <strong>Selected Seats:</strong> ${state.selectedSeats.join(', ')}
              </div>
            ` : ''}
          </div>
        </section>
      </div>

      <div class="floating-cta-container button-row" style="margin-top: 24px;">
        <button class="button button--ghost" type="button" data-action="booking-prev-step" aria-label="Go back" style="padding: 0; min-width: 28px; flex: 0 0 28px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; box-shadow: none; margin-right: 4px;"><i data-lucide="chevron-left" style="width: 24px; height: 24px; color: var(--brand-blue);"></i></button>
        <button class="button button--primary" style="flex: 1;" type="button" data-action="booking-next-step" ${state.selectedSeats.length !== required ? 'disabled style="opacity: 0.65; cursor: not-allowed;"' : ''}>Confirm Seat</button>
      </div>
    `;
  }

  if (step === 4) {
    const totalItems = Object.values(state.luggageQuantities).reduce((a,b) => a+b,0);
    const totalLuggagePrice = luggageTotal();

    return `
      ${screenHead('Luggage Registry', 'Declare larger luggage bags in advance to secure loading space.')}

      <div class="booking-desktop-split booking-desktop-split--sidebar" style="margin-top: 16px;">
        <section class="card" style="margin: 0; padding: 24px; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <h3 style="margin: 0 0 12px 0; font-size: 1rem;">Luggage Declaration Summary</h3>
            <div class="luggage-summary-badge" style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-alt); padding: 14px 18px; border-radius: 14px; border: 1px dashed var(--border);">
              <div>
                <strong style="font-size: 0.95rem; display: block; color: var(--charcoal);">Registered Luggage List</strong>
                <span class="muted" style="font-size: 0.78rem;">${totalItems} items currently declared</span>
              </div>
              <div style="text-align: right;">
                <strong style="color: var(--brand-blue); font-size: 1.25rem; display: block;">${formatUGX(totalLuggagePrice)}</strong>
              </div>
            </div>
          </div>

          <button class="button button--secondary w-full" style="margin-top: 20px;" type="button" data-action="open-luggage-modal"><i data-lucide="plus-circle"></i> Define Luggage & Quantities</button>
        </section>

        <div class="luggage-info-sidebar" style="margin: 0; padding: 24px;">
          <div>
            <h3 style="margin: 0 0 8px 0; font-size: 1.05rem; font-weight: 750; color: var(--charcoal);">Cabin Bag vs Standard Luggage</h3>
              <p class="muted" style="margin: 0; font-size: 0.85rem; line-height: 1.5; text-align: left;">
                <strong>Cabin Bag (Free):</strong> A small handbag, purse, laptop sleeve, or compact daypack that fits comfortably on your lap or under the passenger seat.
              </p>
              <p class="muted" style="margin: 8px 0 0 0; font-size: 0.85rem; line-height: 1.5; text-align: left;">
                <strong>Standard Luggage (Paid):</strong> Large travel suitcases, trunks, heavy storage bags, or commercial boxes. These require rear cargo rack registration to prevent vehicle overloading.
              </p>
            </div>
          </div>
        </section>
      </div>

      <div class="floating-cta-container button-row" style="margin-top: 24px;">
        <button class="button button--ghost" type="button" data-action="booking-prev-step" aria-label="Go back" style="padding: 0; min-width: 28px; flex: 0 0 28px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; box-shadow: none; margin-right: 4px;"><i data-lucide="chevron-left" style="width: 24px; height: 24px; color: var(--brand-blue);"></i></button>
        ${totalItems === 0 ? `
          <button class="button button--primary" type="button" data-action="booking-next-step" style="flex: 1;">Skip</button>
        ` : `
          <button class="button button--primary" type="button" data-action="booking-next-step" style="flex: 1;">Proceed</button>
        `}
      </div>
    `;
  }

  if (step === 6) {
    return renderCheckout();
  }
}

function renderTripResult(trip) {
  const hasEnoughSeats = trip.seats >= passengerTotal();
  const capacity = getVehicleCapacity(trip);
  return `<article class="card card--hover result-card taxi-result-card ${!hasEnoughSeats ? 'is-disabled' : ''}" style="${!hasEnoughSeats ? 'opacity: 0.55; cursor: not-allowed;' : ''}">
    
    <div class="taxi-card-main-layout">
      <!-- LEFT COLUMN -->
      <div class="taxi-card-left-col">
        <span class="taxi-van-type-label">${trip.vehicle} (${capacity})</span>
        <div class="taxi-van-img-wrapper">
          <div class="taxi-van-img-box">
            <img src="${getTripVehicleImage(trip.vehicle)}" alt="Taxibee Vehicle" class="${!hasEnoughSeats ? 'is-grayscale' : ''}">
          </div>
          <!-- Ugandan Plate -->
          <div class="ug-plate-badge">
            <div class="ug-flag-strip"></div>
            <div class="ug-plate-number">${trip.plate}</div>
          </div>
        </div>
      </div>
      
      <!-- RIGHT COLUMN -->
      <div class="taxi-card-right-col">
        <!-- Driver Row -->
        ${(() => {
          const dObj = driversData[trip.driverName.toLowerCase()] || {};
          const avatarUrl = dObj.avatar || 'assets/driver_1-branded.png';
          return `
            <div class="taxi-driver-row" onclick="event.stopPropagation(); showDriverProfileModal('${trip.driverName.toLowerCase()}');">
              <div class="driver-circle-avatar" style="overflow: hidden; border-radius: 50%;">
                <img src="${avatarUrl}" alt="${trip.driverName}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
              </div>
              <div class="driver-text-block">
                <div class="driver-name-rating">
                  <strong class="driver-name-text">${trip.driverName}</strong>
                  <span class="driver-rating-badge">${trip.driverRating} ★</span>
                </div>
                <span class="driver-subtext">Driver</span>
              </div>
            </div>
          `;
        })()}
        
        <!-- Proximity Row -->
        <div class="taxi-proximity-row">
          <span class="proximity-countdown"><i data-lucide="clock"></i> ${trip.countdown}</span>
          <span class="proximity-stage">${trip.currentStage} · ${trip.vansAtStage || 4} departures at stage</span>
        </div>
        
        <!-- Desktop-only Divider and Bottom Row -->
        <div class="taxi-desktop-divider-group">
          <div class="taxi-card-dotted-divider"></div>
          <div class="taxi-desktop-bottom-row">
            <span class="taxi-depart-time-desktop">${trip.depart}</span>
            <span class="taxi-duration-text">${trip.duration} · ${trip.traffic} traffic</span>
            <div class="taxi-seats-left-wrapper">
              ${hasEnoughSeats ? `
                <span class="status-chip ${trip.seats <= 2 ? 'status-chip--warning' : 'status-chip--success'}">${trip.seats} seats left</span>
              ` : `
                <span class="status-chip status-chip--danger">Only ${trip.seats} left (Need ${passengerTotal()})</span>
              `}
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- MOBILE-ONLY DIVIDER AND BOTTOM ROW -->
    <div class="taxi-mobile-bottom-group">
      <div class="taxi-card-dotted-divider-full"></div>
      <div class="taxi-mobile-bottom-row">
        <span class="taxi-depart-time-mobile">${trip.depart}</span>
        <span class="taxi-duration-text-mobile">${trip.duration} · ${trip.traffic} traffic</span>
        <div class="taxi-seats-left-wrapper-mobile">
          ${hasEnoughSeats ? `
            <span class="status-chip ${trip.seats <= 2 ? 'status-chip--warning' : 'status-chip--success'}">${trip.seats} seats left</span>
          ` : `
            <span class="status-chip status-chip--danger">Only ${trip.seats} left</span>
          `}
        </div>
      </div>
    </div>

    <!-- Actions Row (Price & Book Button) -->
    <div class="taxi-result-actions" style="margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 12px;">
      <div class="taxi-price-tag">
        <span class="muted text-small">${state.ticketType === 'return' ? 'Return package' : 'One way'}</span>
        <strong>${formatUGX((state.ticketType === 'return' ? 9000 : trip.fare) * passengerTotal())}</strong>
      </div>
      <button class="button button--primary button--small" type="button" data-action="choose-trip" data-trip-id="${trip.id}">View & Book</button>
    </div>
  </article>`;
}

function renderTripDetails() {
  const trip = state.activeTrip;
  const bookingDate = new Date(`${state.bookingDate}T12:00:00`);
  const reviewDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(bookingDate);
  const returnSummary = state.ticketType === 'return' ? `${state.returnMode === 'date-specific' ? 'Date-specific' : state.returnMode.replace('-', ' ')} · Added` : 'Not added';
  const seatSummary = state.capacityMode === 'seats'
    ? `${state.selectedSeats.join(', ') || 'Choose seats'} (+ ${formatUGX(seatReservationFee())} fee)`
    : 'Best available (Standard rate)';

  const driverHeroImg = getDriverHeroImage(trip.driverName);

  return `<section class="smart-review" aria-label="Review your trip">
    <!-- Top Hero Vehicle & Driver Photo Visual Area -->
    <div class="smart-review__map-card" style="background-image: url('${driverHeroImg}'); background-size: cover; background-position: center; position: relative;">
    </div>

    <div class="smart-review__sheet">
      <div class="sheet-handle" aria-hidden="true"></div>
      
      <!-- Route Title Header Block -->
      <div class="smart-review__header-block" style="margin-bottom: 16px;">
        <h1 style="margin: 0; font-size: clamp(1.4rem, 3.8vw, 1.85rem); font-weight: 850; color: var(--brand-blue-dark); line-height: 1.25;">
          ${trip.boarding.replace(/\s+(Bus Park|Railway Stage|Main Stage|Stage)/gi, '')} → ${trip.destination.replace(/\s+(Bus Park|Railway Stage|Main Stage|Stage)/gi, '')}
        </h1>
      </div>

      <!-- Unified Driver Card (2-Column Layout) -->
      ${(() => {
        const dObj = driversData[trip.driverName.toLowerCase()] || {};
        const driverAvatar = dObj.avatar || 'assets/driver_1-branded.png';
        return `
          <article class="card unified-driver-transit-card" style="margin: 0 0 16px 0; padding: 16px; border: 1px solid var(--border); box-shadow: var(--shadow-sm); background: white; border-radius: 20px; display: grid; grid-template-columns: 88px 1fr; gap: 16px; align-items: center;">
            <!-- Left Profile Column -->
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; position: relative;" onclick="event.stopPropagation(); showDriverProfileModal('${trip.driverName.toLowerCase()}');">
              <div style="width: 84px; height: 84px; border-radius: 50%; overflow: hidden; background: var(--surface-alt); border: 3px solid white; box-shadow: 0 4px 14px rgba(26,26,26,0.15);">
                <img src="${driverAvatar}" alt="${trip.driverName}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />
              </div>
              <div style="margin-top: -12px; z-index: 2; background: white; border-radius: 12px; padding: 2px 8px; box-shadow: 0 3px 8px rgba(26,26,26,0.12); border: 1px solid rgba(26,26,26,0.06); display: inline-flex; align-items: center; gap: 3px; font-size: 0.78rem; font-weight: 800; color: var(--brand-blue-dark);">
                <i data-lucide="star" style="width: 12px; height: 12px; fill: var(--brand-gold); color: var(--brand-gold);"></i> ${trip.driverRating}
              </div>
            </div>
        `;
      })()}

        <!-- Right Driver Details Column (Wider) -->
        <div style="display: flex; flex-direction: column; justify-content: space-between; gap: 10px; min-width: 0;">
          <div>
            <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 700; color: var(--slate); letter-spacing: 0.05em; display: block;">Your Driver</span>
            <h2 style="margin: 2px 0 0 0; font-size: 1.25rem; font-weight: 850; color: var(--brand-blue-dark); cursor: pointer;" onclick="showDriverProfileModal('${trip.driverName.toLowerCase()}');">${trip.driverName}</h2>
            <div style="font-size: 0.84rem; color: var(--muted); font-weight: 600; margin-top: 2px;">
              ${trip.vehicle} · <span class="text-success" style="font-weight: 700;">${trip.plate}</span>
            </div>
          </div>

          <!-- Buttons below driver details in right column -->
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="button button--primary button--small" type="button" data-action="review-call-driver" data-value="${trip.driverName.toLowerCase()}" aria-label="Call Driver" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px; border-radius: 10px; font-weight: 700; font-size: 0.8rem; flex: 1; min-width: 80px;">
              <i data-lucide="phone" style="width: 13px; height: 13px;"></i> Call
            </button>
            <button class="button button--secondary button--small" type="button" data-action="review-chat-driver" data-value="${trip.driverName.toLowerCase()}" aria-label="Message Driver" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px; border-radius: 10px; font-weight: 700; font-size: 0.8rem; background: var(--surface-alt); border: 1px solid var(--border-strong); color: var(--brand-blue-dark); flex: 1.2; min-width: 90px;">
              <i data-lucide="message-square" style="width: 13px; height: 13px;"></i> Message
            </button>
          </div>
        </div>

      </article>

      <!-- Embedded Interactive Route Map (Moved inside sheet) -->
      <div style="margin-bottom: 20px;">
        <div style="position: relative; height: 260px; border-radius: 20px; overflow: hidden; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
          <div id="trip-review-map" class="trip-review-map" style="position: absolute; inset: 0;" aria-label="OpenStreetMap preview from ${trip.boarding} to ${trip.destination}"></div>
          <div id="trip-map-fallback" class="trip-map-fallback" hidden><img src="${getTripVehicleImage(trip.vehicle)}" alt=""><strong>Map preview unavailable</strong><span>Your selected route is still ready.</span></div>
        </div>
      </div>

      <!-- Route Details Box -->
      <div style="background: var(--page); padding: 14px 16px; border-radius: 16px; border: 1px solid var(--border); margin-bottom: 20px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <h3 style="margin: 0; font-size: 0.94rem; font-weight: 800; color: var(--brand-blue-dark);">Route Details</h3>
          <span style="background: rgba(229, 30, 42, 0.08); color: var(--brand-red); font-weight: 750; font-size: 0.78rem; padding: 4px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">
            <i data-lucide="clock" style="width: 13px; height: 13px;"></i> ${trip.countdown}
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; text-align: left; font-size: 0.82rem; padding-top: 2px;">
          <div>
            <span style="font-size: 0.7rem; color: var(--muted); text-transform: uppercase; font-weight: 600; display: block;">From</span>
            <strong style="color: var(--charcoal); font-weight: 700; display: block; margin-top: 2px;">${trip.comingFrom}</strong>
          </div>
          <div>
            <span style="font-size: 0.7rem; color: var(--muted); text-transform: uppercase; font-weight: 600; display: block;">Heading to</span>
            <strong style="color: var(--charcoal); font-weight: 700; display: block; margin-top: 2px;">${trip.headingTo}</strong>
          </div>
        </div>

        <p style="margin: 2px 0 0 0; font-size: 0.78rem; color: var(--slate); line-height: 1.4; border-top: 1px dashed var(--border); padding-top: 8px;">
          Proximity: ${trip.vansAtStage || 4} vehicles currently waiting at stage, ${trip.vansApproaching || 1} on the road approaching.
        </p>
      </div>

      <div class="review-section-label">Selected departure</div>
      <article class="review-departure"><div class="review-departure__time"><strong>${trip.depart.replace(' AM','').replace(' PM','')}</strong><span>${trip.depart.includes('AM') ? 'AM' : 'PM'}</span></div><div class="review-departure__service"><span class="review-vehicle-icon"><i data-lucide="bus-front"></i></span><span><strong>${trip.vehicle}</strong><small>${trip.duration} · ${trip.traffic} traffic · ${trip.plate}</small></span></div><div class="review-departure__price"><span>${trip.seats} seats left</span><strong>${formatUGX(trip.fare)}</strong></div><span class="review-check"><i data-lucide="check"></i></span></article>
      
      <div class="review-section-label review-section-label--options">Make it yours <span>Customize your experience</span></div>
      <div class="booking-accordions">
        ${bookingAccordion('passengers','users-round','Passengers',`${state.passengerCount} adult${state.passengerCount === 1 ? '' : 's'}${state.childCount ? `, ${state.childCount} child${state.childCount === 1 ? '' : 'ren'}` : ''}`,reviewPassengerOptions())}
        ${bookingAccordion('assistance','headphones','Assistance & language',`${state.assistance} · ${state.language}`,reviewAssistanceOptions())}
        ${bookingAccordion('luggage','luggage','Luggage',luggageSummary(),reviewLuggageOptions())}
        ${bookingAccordion('seats','armchair','Seat preference',seatSummary,reviewSeatOptions())}
      </div>
      <div class="review-reassurance"><i data-lucide="shield-check"></i><span>Personal item included</span><span>•</span><span>Change anything before payment.</span></div>
      <div class="review-immediate-reassurance" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-subtle); color: var(--slate); font-size: 0.84rem; font-weight: 500; line-height: 1.45;">
        Your seat is held immediately upon booking — you can either board at stage or meet the vehicle along the route!
      </div>
    </div>
  </section>
  <div class="review-sticky-cta">
    <button class="return-quick-toggle ${state.ticketType === 'return' ? 'is-on' : ''}" type="button" data-action="quick-return-toggle" aria-pressed="${state.ticketType === 'return'}">
      <i data-lucide="${state.ticketType === 'return' ? 'check' : 'refresh-cw'}" style="width: 15px; height: 15px;"></i>
      <span>${state.ticketType === 'return' ? 'Return added' : '+ Return'}</span>
    </button>
    <button class="button button--primary review-pay-button" type="button" data-action="continue-to-checkout">
      <span>Continue</span>
      <div style="display: flex; align-items: center; gap: 6px;">
        <strong>${formatUGX(tripReviewFare())}</strong>
        <i data-lucide="arrow-right" style="width: 17px; height: 17px;"></i>
      </div>
    </button>
  </div>`;
}

function renderPassengers() {
  const passengerCards = Array.from({ length: state.passengerCount + state.childCount }, (_, index) => {
    const isChild = index >= state.passengerCount;
    if (!state.passengerDetails[index]) {
      state.passengerDetails[index] = { name: isChild ? 'Amina Nabirye' : '', phone: '', category: isChild ? 'Child passenger' : 'Adult passenger', assistance: 'None required', emergency: '+256 700 123 456' };
    }
    const passenger = state.passengerDetails[index];
    return `<article class="card passenger-card">
      <div class="card-head"><div style="display:flex;align-items:center;gap:10px"><span class="passenger-card__number">${index + 1}</span><div><h3>${isChild ? 'Child passenger' : `Passenger ${index + 1}`}</h3><span class="muted text-small">${isChild ? 'Child category' : index === 0 ? 'Primary passenger' : 'Adult passenger'}</span></div></div><span class="status-chip status-chip--info">${isChild ? 'Child' : 'Adult'}</span></div>
      <div class="form-grid">
        <div class="field"><label for="passenger-name-${index}">Full name</label><input id="passenger-name-${index}" data-passenger-index="${index}" data-passenger-field="name" value="${escapeHtml(passenger.name)}" placeholder="Passenger name"></div>
        <div class="field"><label for="passenger-phone-${index}">Telephone number</label><input id="passenger-phone-${index}" data-passenger-index="${index}" data-passenger-field="phone" value="${escapeHtml(passenger.phone)}" placeholder="+256 ..."></div>
        <div class="field"><label for="passenger-category-${index}">Passenger category</label><select id="passenger-category-${index}" data-passenger-index="${index}" data-passenger-field="category">${[isChild ? 'Child passenger' : 'Adult passenger','Senior passenger','Passenger with disability'].map(value => optionMarkup(value, passenger.category)).join('')}</select></div>
        <div class="field"><label for="passenger-assistance-${index}">Special assistance</label><select id="passenger-assistance-${index}" data-passenger-index="${index}" data-passenger-field="assistance">${['None required','Boarding assistance','Priority seating','Mobility support'].map(value => optionMarkup(value, passenger.assistance)).join('')}</select></div>
        <div class="field field--full"><label for="passenger-emergency-${index}">Emergency contact</label><input id="passenger-emergency-${index}" data-passenger-index="${index}" data-passenger-field="emergency" value="${escapeHtml(passenger.emergency)}"></div>
      </div>
    </article>`;
  }).join('');

  return `
    ${screenHead('Passengers and capacity', 'Choose Taxibee capacity reservation or preview an individually numbered seating layout.')}
    <section class="grid grid--sidebar">
      <div class="grid">
        <article class="card">
          <div class="card-head"><div><p class="section-kicker">Reservation mode</p><h2>How should capacity be demonstrated?</h2></div><span class="status-chip status-chip--info">Prototype choice</span></div>
          <div class="mode-switch"><button class="${state.capacityMode === 'capacity' ? 'is-active' : ''}" type="button" data-action="capacity-mode" data-value="capacity" aria-pressed="${state.capacityMode === 'capacity'}">Reserved Capacity</button><button class="${state.capacityMode === 'seats' ? 'is-active' : ''}" type="button" data-action="capacity-mode" data-value="seats" aria-pressed="${state.capacityMode === 'seats'}">Seat Selection</button></div>
          ${state.capacityMode === 'capacity' ? renderCapacityMode() : renderSeatMode()}
        </article>
        <div class="section-title"><h2>Passenger details</h2><div class="button-row"><button class="button button--ghost button--small" type="button" data-action="add-adult"><i data-lucide="user-plus"></i>Add Adult</button><button class="button button--ghost button--small" type="button" data-action="add-child"><i data-lucide="baby"></i>Add Child</button></div></div>
        ${passengerCards}
      </div>
      <aside class="grid">
        <article class="card"><p class="section-kicker">Booking summary</p><div class="detail-list"><div class="detail-row"><span>Adults</span><strong>${state.passengerCount}</strong></div><div class="detail-row"><span>Children</span><strong>${state.childCount}</strong></div><div class="detail-row"><span>Reserved capacity</span><strong>${state.passengerCount + state.childCount}</strong></div><div class="detail-row"><span>Reference</span><strong>${state.capacityMode === 'seats' ? state.selectedSeats.join(', ') || 'Not selected' : 'Position 04'}</strong></div></div></article>
        <article class="card card--soft"><h3>Passenger privacy</h3><p class="muted text-small">These details remain only in browser memory for this session and reset when the page refreshes.</p></article>
        <div class="floating-cta-container">
          <button class="button button--primary w-full" type="button" data-screen="returns">Continue to Ticket Type</button>
        </div>
      </aside>
    </section>`;
}

function renderCapacityMode() {
  return `<div class="grid grid--2">
    <div><div class="capacity-number"><strong>${state.passengerCount + state.childCount}</strong><span class="muted">passenger${state.passengerCount + state.childCount === 1 ? '' : 's'} reserved</span></div><p class="muted">Guaranteed boarding capacity without an individually assigned seat number.</p><div class="choice-pills"><button class="choice-pill" type="button" data-action="decrease-passengers">− Passenger</button><button class="choice-pill is-selected" type="button">Position 04</button><button class="choice-pill" type="button" data-action="add-adult">+ Passenger</button></div></div>
    <div class="occupancy"><div class="card-head"><strong>Vehicle occupancy</strong><span>12 of 18 reserved</span></div><div class="occupancy-bar"><span></span></div><div class="detail-row"><span>Remaining capacity</span><strong>6 passengers</strong></div><div class="detail-row"><span>Boarding guarantee</span><strong class="text-success">Confirmed</strong></div></div>
  </div>`;
}

function renderSeatMode() {
  const occupied = ['1A','1B','2A','2D','3B','4A'];
  const priority = ['1C','1D'];
  const seats = ['1A','1B','1C','1D','2A','2B','2C','2D','3A','3B','3C','3D','4A','4B','4C','4D'];
  return `<div class="vehicle-layout"><div class="vehicle-front"><div class="driver-seat"><i data-lucide="gauge"></i>Driver</div><div class="entrance"><i data-lucide="door-open"></i>Entrance</div></div><div class="seat-grid">${seats.map(seat => `<button class="seat ${occupied.includes(seat) ? 'is-occupied' : ''} ${priority.includes(seat) ? 'is-priority' : ''} ${state.selectedSeats.includes(seat) ? 'is-selected' : ''}" type="button" data-action="toggle-seat" data-seat="${seat}" ${occupied.includes(seat) ? 'disabled aria-label="Occupied seat '+seat+'"' : `aria-label="Select seat ${seat}"`}>${seat}</button>`).join('')}</div><div class="seat-legend"><span><i class="legend-box"></i>Available</span><span><i class="legend-box legend-box--selected"></i>Selected</span><span><i class="legend-box legend-box--occupied"></i>Occupied</span><span><i class="legend-box legend-box--priority"></i>Priority</span></div></div>`;
}

function renderReturns() {
  const expiry = '21 July 2026, 10:00 PM';
  return `
    ${screenHead('Choose your ticket type', 'Compare a standard one-way booking with Taxibee discounted return travel.')}
    <section class="grid grid--2">
      <article class="card card--hover ticket-option ${state.ticketType === 'oneway' ? 'is-selected' : ''}" data-action="select-ticket-type" data-value="oneway" role="button" tabindex="0">
        <span class="ticket-option__badge status-chip status-chip--info">Simple trip</span><p class="section-kicker">One-way ticket</p><h2>Entebbe to Kampala</h2><div class="ticket-option__price">UGX 5,000</div><p class="muted">Valid for the selected departure only.</p><ul><li>Selected departure: 8:30 AM</li><li>Digital ticket and booking reference</li><li>Optional paid luggage registration</li></ul><button class="button button--ghost" type="button" data-action="select-ticket-type" data-value="oneway">Choose One Way</button>
      </article>
      <article class="card card--hover ticket-option ${state.ticketType === 'return' ? 'is-selected' : ''}" data-action="select-ticket-type" data-value="return" role="button" tabindex="0">
        <span class="ticket-option__badge status-chip status-chip--success">Best value</span><p class="section-kicker">Discounted return ticket</p><h2>Entebbe ⇄ Kampala</h2><div class="ticket-option__price">UGX 9,000</div><div class="savings-banner"><i data-lucide="badge-percent"></i>Passenger saves UGX 1,000</div><ul><li>Outbound value: UGX 5,000</li><li>Return journey value: UGX 4,000</li><li>Return reminder before expiry</li></ul><button class="button button--primary" type="button" data-action="select-ticket-type" data-value="return">Choose Return Package</button>
      </article>
    </section>

    <section class="card" style="margin-top:18px">
      <div class="card-head"><div><p class="section-kicker">Return flexibility</p><h2>Select how the return should work</h2></div><span class="status-chip status-chip--warning">Demo conditions</span></div>
      <div class="grid grid--4">
        ${returnOption('same-day','Same-day return','Return on an eligible departure today.','calendar-check')}
        ${returnOption('date-specific','Date-specific','Reserve a return date now.','calendar-days')}
        ${returnOption('open','Open return','Choose an eligible departure later.','calendar-range')}
        ${returnOption('promotional','Promotional return','Limited campaign validity applies.','sparkles')}
      </div>
      <div class="notice" style="margin-top:16px"><i data-lucide="clock-3"></i><div><strong>${state.returnMode === 'open' ? 'Use your return ticket on an eligible departure before the expiry date.' : 'Your selected return conditions will appear on the ticket.'}</strong><div>Simulated expiry: ${expiry}. A reminder will appear three days before expiry.</div></div></div>
      <div class="floating-cta-container">
        <button class="button button--primary w-full" type="button" data-screen="luggage">Continue to Luggage</button>
      </div>
    </section>`;
}

function returnOption(value, title, copy, icon) {
  return `<button class="card card--compact card--hover ${state.returnMode === value ? 'ticket-option is-selected' : ''}" style="text-align:left;cursor:pointer" type="button" data-action="return-mode" data-value="${value}" aria-pressed="${state.returnMode === value}"><span class="quick-action__icon"><i data-lucide="${icon}"></i></span><h3 style="margin:10px 0 5px">${title}</h3><span class="muted text-small">${copy}</span></button>`;
}

function luggageTotal() {
  return appData.luggage.reduce((sum, item) => sum + (item.price || 0) * (state.luggageQuantities[item.id] || 0), 0);
}

function renderLuggage() {
  const total = luggageTotal();
  return `
    ${screenHead('Register luggage', 'Declare luggage before checkout to receive a clear charge and a digital luggage reference.', '<button class="button button--ghost" type="button" data-action="no-luggage">No Additional Luggage</button>')}
    <section class="grid grid--sidebar">
      <div class="card">
        <div class="card-head"><div><p class="section-kicker">Luggage categories</p><h2>What are you bringing?</h2></div><span class="status-chip status-chip--info">Small item free</span></div>
        <div class="luggage-list">
          ${appData.luggage.map(item => `<div class="luggage-item"><div class="luggage-icon"><i data-lucide="${item.icon}"></i></div><div class="luggage-item__copy"><strong>${item.name}</strong><span>${item.desc} · ${item.guide}</span></div><div class="luggage-price">${formatUGX(item.price)}</div><div class="stepper"><button type="button" data-action="luggage-minus" data-id="${item.id}" aria-label="Remove ${item.name}">−</button><span>${state.luggageQuantities[item.id] || 0}</span><button type="button" data-action="luggage-plus" data-id="${item.id}" aria-label="Add ${item.name}">+</button></div></div>`).join('')}
        </div>
      </div>
      <aside class="grid">
        <article class="luggage-tag"><p class="section-kicker" style="color:var(--brand-gold)">Digital luggage tag preview</p><h2>LUG-1842</h2><div class="detail-list"><div class="detail-row"><span>Passenger</span><strong>${escapeHtml(state.passengerDetails[0]?.name || appData.passenger.name)}</strong></div><div class="detail-row"><span>Ticket</span><strong>FET-884210</strong></div><div class="detail-row"><span>Vehicle</span><strong>${state.activeTrip.plate}</strong></div><div class="detail-row"><span>Items</span><strong>${Object.values(state.luggageQuantities).reduce((a,b) => a+b,0)}</strong></div></div></article>
        <article class="card"><p class="section-kicker">Luggage total</p><div class="wallet-balance">${formatUGX(total)}</div><p class="muted">Commercial luggage is assessed by an authorized stage agent.</p><div class="notice"><i data-lucide="shield-alert"></i><div>Label fragile items clearly and keep valuables with you.</div></div></article>
        <div class="floating-cta-container">
          <button class="button button--primary w-full" type="button" data-screen="checkout">Continue to Checkout</button>
        </div>
      </aside>
    </section>`;
}

function seatReservationFee() {
  if (state.capacityMode !== 'seats') return 0;
  const count = state.selectedSeats.length > 0 ? state.selectedSeats.length : passengerTotal();
  return 1000 * count;
}

function checkoutBaseFare() {
  return (state.ticketType === 'return' ? 9000 : 5000) * passengerTotal();
}

function checkoutTotal() {
  return Math.max(0, checkoutBaseFare() + seatReservationFee() + luggageTotal() - (state.voucherApplied ? 2000 : 0));
}

function renderCheckout() {
  const total = checkoutTotal();
  const walletRemaining = state.walletBalance - total;
  const isOpen = !!state.orderSummaryOpen;

  const summaryListHtml = `
    <div class="detail-list">
      <div class="detail-row"><span>Route</span><strong>${state.activeTrip ? `${state.activeTrip.boarding} → ${state.activeTrip.destination}` : 'Travel Journey'}</strong></div>
      <div class="detail-row"><span>Travel date</span><strong>${formatDemoDate(state.bookingDate)} ${state.activeTrip ? `· ${state.activeTrip.depart}` : ''}</strong></div>
      <div class="detail-row"><span>Ticket type</span><strong>${state.ticketType === 'return' ? `${state.returnMode.replace('-', ' ')} return` : 'One way'}</strong></div>
      <div class="detail-row"><span>Passengers</span><strong>${passengerTotal()} traveler${passengerTotal() > 1 ? 's' : ''}</strong></div>
      <div class="detail-row"><span>Seat preference</span><strong>${state.capacityMode === 'seats' ? (state.selectedSeats.join(', ') || 'Choose seats') : 'Best available'}</strong></div>
      <div class="detail-row"><span>Base ticket fare</span><strong>${formatUGX(checkoutBaseFare())}</strong></div>
      <div class="detail-row"><span>Seat reservation fee</span><strong>${state.capacityMode === 'seats' ? `+ ${formatUGX(seatReservationFee())}` : 'Included'}</strong></div>
      <div class="detail-row"><span>Luggage charges</span><strong>${formatUGX(luggageTotal())}</strong></div>
      ${state.ticketType === 'return' ? `<div class="detail-row"><span>Return saving</span><strong class="text-success">− ${formatUGX(1000 * passengerTotal())}</strong></div>` : ''}
      ${state.voucherApplied ? `<div class="detail-row"><span>Voucher discount</span><strong class="text-success">− UGX 2,000</strong></div>` : ''}
      <div class="detail-row"><span>Service fee</span><strong>Included</strong></div>
    </div>
  `;

  return `
    ${screenHead('Checkout and payment preview', 'Review the service total and choose a simulated payment method. No money will be processed.')}
    
    <div class="checkout-unified-layout">
      
      <!-- Mobile-only Shopify Order Summary Accordion -->
      <div class="shopify-summary-card mobile-summary-accordion ${isOpen ? 'is-open' : ''}">
        <div class="shopify-summary-header" data-action="toggle-order-summary" role="button" tabindex="0">
          <div class="shopify-summary-title">
            <i data-lucide="shopping-bag" style="width: 18px; height: 18px; color: var(--brand-blue-dark);"></i>
            <span>${isOpen ? 'Hide order summary' : 'Show order summary'}</span>
            <i data-lucide="chevron-down" class="shopify-accordion-arrow"></i>
          </div>
          <div class="shopify-summary-price">
            ${formatUGX(total)}
          </div>
        </div>
        ${isOpen ? `
          <div class="shopify-summary-body">
            ${summaryListHtml}
            <div class="total-row" style="border-top: 2px solid var(--border); padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 850;">
              <span>Final Total</span>
              <strong>${formatUGX(total)}</strong>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="checkout-grid-container">
        <!-- Main Form Column -->
        <div class="checkout-main-col">
          <article class="card" style="margin-bottom: 20px;">
            <div class="card-head">
              <div>
                <p class="section-kicker">Payment method</p>
                <h2 style="font-size: 1.2rem; font-weight: 850; color: var(--brand-blue-dark); margin: 0;">How would you like to pay?</h2>
              </div>
              <span class="status-chip status-chip--warning">Demo mode</span>
            </div>

            ${renderStandardPaymentOptions(state.paymentMethod, 'payment-method', 'Pay the dispatcher before boarding')}

            <div style="margin-top: 16px;">
              ${renderPaymentPanel(total, walletRemaining)}
            </div>
          </article>

          <article class="card card--soft" style="margin-bottom: 24px;">
            <label class="checkbox-row" style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
              <input id="booking-conditions" type="checkbox" checked style="margin-top: 2px;">
              <span>
                <strong>I accept the booking conditions.</strong><br>
                <span class="muted text-small">This confirms only a presentation-state booking and does not create a real reservation.</span>
              </span>
            </label>
          </article>

          <div class="floating-cta-container">
            <button class="button button--golden-orange w-full checkout-pay-btn" type="button" data-action="confirm-booking">
              <i data-lucide="shield-check" style="width: 20px; height: 20px;"></i>
              <span>Complete Booking — ${formatUGX(total)}</span>
            </button>
          </div>

          <p class="privacy-note center" style="margin-top: 12px;">No backend, gateway, mobile-money service or database will be contacted.</p>
        </div>

        <!-- Desktop Right Sidebar -->
        <aside class="checkout-sidebar-col">
          <div class="card checkout-summary-card">
            <div class="card-head" style="margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <i data-lucide="shopping-bag" style="width: 18px; height: 18px; color: var(--brand-blue-dark);"></i>
                <h2 style="font-size: 1.1rem; font-weight: 850; color: var(--brand-blue-dark); margin: 0;">Order summary</h2>
              </div>
            </div>
            ${summaryListHtml}
            <div class="total-row" style="border-top: 2px solid var(--border); padding-top: 12px; margin-top: 12px; display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 850;">
              <span>Final Total</span>
              <strong>${formatUGX(total)}</strong>
            </div>
          </div>
        </aside>
      </div>

    </div>
  `;
}

function renderStandardPaymentOptions(selectedMethod, radioName = 'payment-method', cashSubtitle = 'Pay the dispatcher before boarding') {
  return `
    <div class="radio-cards">
      ${paymentChoiceTile('wallet', 'Taxibee Wallet', `Available balance: ${formatUGX(state.walletBalance)}`, 'wallet-cards', selectedMethod, radioName)}
      ${paymentChoiceTile('mobile', 'Mobile Money', 'MTN MoMo or Airtel Money', 'smartphone', selectedMethod, radioName)}
      ${paymentChoiceTile('cash', 'Cash at Stage', cashSubtitle, 'banknote', selectedMethod, radioName)}
      ${paymentChoiceTile('corporate', 'Corporate Travel Account', 'For approved business travellers', 'building-2', selectedMethod, radioName)}
      ${paymentChoiceTile('voucher', 'Promotional Voucher', 'Apply an eligible campaign code', 'ticket-percent', selectedMethod, radioName)}
    </div>
  `;
}

function paymentChoiceTile(value, title, copy, icon, currentMethod, radioName) {
  const isSelected = currentMethod === value;
  return `<label class="radio-card ${isSelected ? 'is-selected' : ''}">
    <input type="radio" name="${radioName}" value="${value}" ${isSelected ? 'checked' : ''}>
    <span class="radio-card__icon"><i data-lucide="${icon}"></i></span>
    <span class="radio-card__body"><strong>${title}</strong><span>${copy}</span></span>
  </label>`;
}

function renderPaymentPanel(total, walletRemaining) {
  if (state.paymentMethod === 'wallet') {
    return `<div class="payment-panel">
      <div class="grid grid--3" style="gap: 12px; margin-bottom: 4px;">
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Current balance</span>
          <strong style="font-size: 0.97rem; color: var(--brand-blue-dark);">${formatUGX(state.walletBalance)}</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Amount due</span>
          <strong style="font-size: 0.97rem; color: var(--brand-blue-dark);">${formatUGX(total)}</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Remaining balance</span>
          <strong class="${walletRemaining < 0 ? 'text-danger' : 'text-success'}" style="font-size: 0.97rem;">${formatUGX(walletRemaining)}</strong>
        </div>
      </div>
      <div class="field" style="margin-top:13px"><label for="wallet-pin">Wallet PIN</label><input id="wallet-pin" type="password" inputmode="numeric" maxlength="4" value="2580"><span class="field-help">Any four digits are accepted in this preview.</span></div>
    </div>`;
  }
  if (state.paymentMethod === 'mobile' || state.paymentMethod === 'mtn' || state.paymentMethod === 'airtel') {
    if (state.paymentDemoState === 'pending') return paymentState('pending','Authorization pending',`A simulated Mobile Money prompt is awaiting approval.`);
    if (state.paymentDemoState === 'success') return paymentState('success','Authorization successful','The mockup payment state has been approved.');
    if (state.paymentDemoState === 'failed') return paymentState('failed','Authorization failed','The demonstration request was declined. Try another state.');
    return `<div class="payment-panel"><div class="form-grid"><div class="field"><label>Operator</label><select id="mobile-operator" style="padding: 8px; border-radius: 8px; border: 1px solid var(--border); width: 100%;"><option ${state.paymentMethod === 'airtel' ? '' : 'selected'}>MTN MoMo</option><option ${state.paymentMethod === 'airtel' ? 'selected' : ''}>Airtel Money</option></select></div><div class="field"><label>Telephone number</label><input value="+256 772 345 678"></div></div><div class="button-row" style="margin-top:13px"><button class="button button--secondary button--small" type="button" data-action="payment-state" data-value="pending">Simulate Pending</button><button class="button button--success button--small" type="button" data-action="payment-state" data-value="success">Simulate Success</button><button class="button button--soft-red button--small" type="button" data-action="payment-state" data-value="failed">Simulate Failure</button></div></div>`;
  }
  if (state.paymentMethod === 'cash') return `<div class="payment-panel"><div class="notice"><i data-lucide="clock-3"></i><div><strong>Reservation held for 15 demonstration minutes.</strong><div>Pay the dispatcher before boarding. Booking reference FX-260718-1842 will show Payment Pending until confirmed.</div></div></div></div>`;
  if (state.paymentMethod === 'corporate') return `<div class="payment-panel"><div class="field"><label for="corporate-reference">Corporate account reference</label><input id="corporate-reference" value="TAXIBEE-CORP-DEMO-24"></div><p class="muted text-small">The account will be shown as awaiting corporate approval.</p></div>`;
  return `<div class="payment-panel"><div class="field"><label for="voucher-code">Promotional voucher</label><input id="voucher-code" value="${state.voucherApplied ? 'TAXIBEE2000' : ''}" placeholder="Enter TAXIBEE2000"></div><button class="button button--secondary button--small" style="margin-top:10px" type="button" data-action="apply-voucher">Apply Demo Voucher</button><p class="muted text-small" style="margin-top:10px">A voucher reduces the total; choose another method to pay the balance.</p></div>`;
}

function renderSpecialHirePaymentPanel(priceDetails) {
  const sh = state.specialHire;
  const total = priceDetails.total;
  const walletRemaining = state.walletBalance - total;

  if (sh.paymentMethod === 'wallet') {
    return `<div class="payment-panel">
      <div class="grid grid--3" style="gap: 12px; margin-bottom: 4px;">
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Charter Total</span>
          <strong style="font-size: 0.97rem; color: var(--brand-blue-dark);">${formatUGX(total)}</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Wallet Balance</span>
          <strong style="font-size: 0.97rem; color: var(--brand-blue-dark);">${formatUGX(state.walletBalance)}</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Remaining Balance</span>
          <strong class="${walletRemaining < 0 ? 'text-danger' : 'text-success'}" style="font-size: 0.97rem;">${formatUGX(walletRemaining)}</strong>
        </div>
      </div>
      <div class="field" style="margin-top:13px"><label for="hire-wallet-pin">Wallet PIN</label><input id="hire-wallet-pin" type="password" inputmode="numeric" maxlength="4" value="2580"><span class="field-help">Any four digits are accepted in this preview.</span></div>
    </div>`;
  }

  if (sh.paymentMethod === 'mobile' || sh.paymentMethod === 'mtn' || sh.paymentMethod === 'airtel') {
    if (sh.paymentDemoState === 'pending') return paymentState('pending', 'Authorization pending', 'A simulated Mobile Money prompt is awaiting approval.', 'hire-payment-reset');
    if (sh.paymentDemoState === 'success') return paymentState('success', 'Authorization successful', 'The mockup payment state has been approved.', 'hire-payment-reset');
    if (sh.paymentDemoState === 'failed') return paymentState('failed', 'Authorization failed', 'The demonstration request was declined.', 'hire-payment-reset');

    return `<div class="payment-panel">
      <div class="form-grid">
        <div class="field"><label>Operator</label><select id="hire-mobile-operator" style="padding: 8px; border-radius: 8px; border: 1px solid var(--border); width: 100%;"><option ${sh.paymentMethod === 'airtel' ? '' : 'selected'}>MTN MoMo</option><option ${sh.paymentMethod === 'airtel' ? 'selected' : ''}>Airtel Money</option></select></div>
        <div class="field"><label>Telephone number</label><input value="${escapeHtml(appData.passenger.phone)}"></div>
      </div>
      <div class="button-row" style="margin-top:13px">
        <button class="button button--secondary button--small" type="button" data-action="hire-payment-state" data-value="pending">Simulate Pending</button>
        <button class="button button--success button--small" type="button" data-action="hire-payment-state" data-value="success">Simulate Success</button>
        <button class="button button--soft-red button--small" type="button" data-action="hire-payment-state" data-value="failed">Simulate Failure</button>
      </div>
    </div>`;
  }

  if (sh.paymentMethod === 'cash') {
    return `<div class="payment-panel"><div class="notice"><i data-lucide="clock-3"></i><div><strong>Reservation held for demonstration.</strong><div>Pay the dispatcher or driver before departure. Permit status will show Payment Pending until confirmed.</div></div></div></div>`;
  }

  if (sh.paymentMethod === 'corporate') {
    return `<div class="payment-panel"><div class="field"><label for="hire-corporate-ref">Corporate account reference</label><input id="hire-corporate-ref" value="TAXIBEE-CORP-HIRE-09"></div><p class="muted text-small">Charter invoice will be routed to your corporate account.</p></div>`;
  }

  return `<div class="payment-panel"><div class="field"><label for="hire-voucher-code">Promotional voucher</label><input id="hire-voucher-code" value="${sh.voucherApplied ? 'SPECIAL2026' : ''}" placeholder="Enter SPECIAL2026"></div><button class="button button--secondary button--small" style="margin-top:10px" type="button" data-action="apply-hire-voucher">Apply Demo Voucher</button><p class="muted text-small" style="margin-top:10px">A voucher reduces the total; choose another method to pay the balance.</p></div>`;
}

function paymentState(type, title, copy, action = 'payment-reset') {
  const icon = type === 'pending' ? 'loader-circle' : type === 'success' ? 'circle-check-big' : 'circle-x';
  return `<div class="payment-panel payment-state"><div class="payment-state__icon payment-state__icon--${type}"><i data-lucide="${icon}"></i></div><h3>${title}</h3><p class="muted">${copy}</p><button class="button button--ghost button--small" type="button" data-action="${action}">Reset State</button></div>`;
}

function renderSuccess() {
  const paid = state.paymentMethod === 'cash' ? 'Payment Pending' : 'Paid';
  return `<section class="success-screen">
    <div class="success-check"><i data-lucide="check"></i></div>
    <p class="eyebrow">Booking successful</p><h1>Your trip is reserved</h1><p class="muted">A presentation booking has been created in browser memory only.</p>
    <div class="booking-reference"><i data-lucide="copy"></i>FX-260718-1842</div>
    <article class="card" style="text-align:left"><div class="detail-list"><div class="detail-row"><span>Route</span><strong>Entebbe Main Stage → Kampala Main Stage</strong></div><div class="detail-row"><span>Departure</span><strong>18 Jul 2026 · 8:30 AM</strong></div><div class="detail-row"><span>Boarding stage</span><strong>Entebbe Main Stage</strong></div><div class="detail-row"><span>Passengers</span><strong>${state.passengerCount + state.childCount}</strong></div><div class="detail-row"><span>Amount</span><strong>${formatUGX(checkoutTotal())}</strong></div><div class="detail-row"><span>Payment method</span><strong>${paymentLabel()}</strong></div><div class="detail-row"><span>Payment status</span><strong class="${paid === 'Paid' ? 'text-success' : ''}">${paid}</strong></div></div></article>
    <div class="button-row" style="justify-content:center;margin-top:18px"><button class="button button--primary" type="button" data-screen="ticket"><i data-lucide="ticket-check"></i>View Ticket</button><button class="button button--ghost" type="button" data-action="calendar-demo"><i data-lucide="calendar-plus"></i>Add to Calendar</button><button class="button button--ghost" type="button" data-action="share-demo"><i data-lucide="share-2"></i>Share Ticket</button><button class="button button--ghost" type="button" data-screen="home">Return Home</button></div>
  </section>`;
}

function paymentLabel(method = state.paymentMethod) {
  return ({ wallet: 'Taxibee Wallet', mobile: 'Mobile Money', cash: 'Cash at Stage', corporate: 'Corporate Travel Account', voucher: 'Promotional Voucher' })[method] || 'Demo Payment';
}

function renderDigitalTicketCard(ticketData = {}, isModal = false) {
  const ticket = Object.assign({
    id: 'FET-884210',
    bookingRef: 'FX-260718-1842',
    route: 'Entebbe Bus Park → Kampala Railway Stage',
    cityA: 'Entebbe Bus Park',
    cityB: 'Kampala Railway Stage',
    stageA: 'Entebbe Bus Park',
    stageB: 'Kampala Railway Stage',
    via: 'Via Kajansi Express',
    date: '18 July 2026',
    time: '08:30 AM',
    seat: 'Seat 04',
    passenger: 'Christo I.',
    price: 'UGX 5,000',
    status: 'active',
    vanNumber: 'UBM 245K',
    driver: 'Julius Musoke'
  }, ticketData);

  const isExpired = ticket.status === 'used' || ticket.status === 'expired';
  const statusLabel = ticket.status === 'active' ? 'Active' : (ticket.status === 'used' ? 'Used' : 'Expired');
  const statusSubtext = ticket.status === 'active' ? 'Ready for boarding' : (ticket.status === 'used' ? 'Journey completed' : 'Travel date has passed');
  const statusIcon = ticket.status === 'active' ? 'check-circle-2' : (ticket.status === 'used' ? 'check-circle' : 'clock-3');

  let fromPlace = ticket.cityA || ticket.stageA || 'Entebbe Bus Park';
  let toPlace = ticket.cityB || ticket.stageB || 'Kampala Railway Stage';
  if (ticket.route && ticket.route.includes('→')) {
    const parts = ticket.route.split('→').map(s => s.trim());
    if (parts.length === 2) {
      fromPlace = parts[0];
      toPlace = parts[1];
    }
  }

  return `
    <article class="digital-ticket ${isExpired ? 'is-expired' : ''}">
      <header class="ticket-header" style="background: ${isExpired ? '#1a1a1a' : 'linear-gradient(135deg, #c9a227 0%, #1a1a1a 50%, #0a0a0a 100%)'} !important;">
        <div class="ticket-brand">
          <div class="logo-frame logo-frame--ticket">
            <img src="assets/peebee-logo.svg" alt="Taxibee logo">
          </div>
          <div>
            <h2>Taxibee</h2>
            <p>Passenger Digital Ticket</p>
          </div>
        </div>
        ${isModal ? `
          <button type="button" class="icon-button" onclick="closeTicketModal();" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 6px; border-radius: 50%; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;" title="Close">
            <i data-lucide="x"></i>
          </button>
        ` : ''}
      </header>

      <div class="ticket-body">
        <!-- Status Banner Box -->
        <div class="ticket-status-banner" style="display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: 16px; margin-bottom: 22px; background: ${ticket.status === 'active' ? '#eefbf4' : '#faf8ef'}; border: 1px solid ${ticket.status === 'active' ? '#bbf7d0' : '#f1eee4'};">
          <div style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${ticket.status === 'active' ? '#22c55e' : '#1a1a1a'}; color: white; flex-shrink: 0;">
            <i data-lucide="${statusIcon}" style="width: 18px; height: 18px;"></i>
          </div>
          <div>
            <strong style="display: block; font-size: 0.98rem; font-weight: 850; color: ${ticket.status === 'active' ? '#15803d' : '#1a1a1a'}; margin: 0;">
              ${statusLabel}
            </strong>
            <span style="font-size: 0.8rem; color: ${ticket.status === 'active' ? '#166534' : '#1a1a1a'}; font-weight: 600; display: block; margin-top: 1px;">
              ${statusSubtext}
            </span>
          </div>
        </div>

        <!-- Route Block -->
        <div class="ticket-route">
          <div class="ticket-route__place">
            <span>FROM</span>
            <strong>${escapeHtml(fromPlace)}</strong>
            <span>Pickup stage</span>
          </div>
          <div class="ticket-route__arrow">
            <i data-lucide="arrow-right"></i>
          </div>
          <div class="ticket-route__place">
            <span>TO</span>
            <strong>${escapeHtml(toPlace)}</strong>
            <span>Drop-off stage</span>
          </div>
        </div>

        <!-- Ticket Field Grid -->
        <div class="ticket-grid">
          ${ticketField('Passenger', escapeHtml(ticket.passenger || 'Christo I.'))}
          ${ticketField('Booking reference', escapeHtml(ticket.bookingRef || 'FX-260718-1842'))}
          ${ticketField('Ticket number', escapeHtml(ticket.id || 'FET-884210'))}
          ${ticketField('Travel date', escapeHtml(ticket.date || '18 July 2026'))}
          ${ticketField('Departure', escapeHtml(ticket.time || '08:30 AM'))}
          ${ticketField('Assigned seat', escapeHtml(ticket.seat || 'Seat 04'))}
          ${ticketField('Vehicle', escapeHtml(ticket.vanNumber || 'UBM 245K'))}
          ${ticketField('Driver', escapeHtml(ticket.driver || 'Julius Musoke'))}
          ${ticketField('Routing via', escapeHtml(ticket.via || 'Via Kajansi Express'))}
          ${ticketField('Fare paid', escapeHtml(ticket.price || 'UGX 5,000'))}
        </div>

        <!-- Verification QR Code Area -->
        <div class="ticket-code-area" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 22px 18px; background: #faf8ef; border-radius: 20px; border: 1px solid var(--border); text-align: center; margin-top: 22px;">
          <div id="ticket-qr-${ticket.id}" class="qr-code-frame" style="background: #ffffff; padding: 12px; border-radius: 16px; border: 1.5px solid var(--border); box-shadow: 0 4px 14px rgba(26,26,26,0.06); width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px;">
            ${generateQrSvg(ticket.id || '482915', 136)}
          </div>
          <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 800; color: var(--slate); letter-spacing: 0.08em; display: block;">VERIFICATION CODE</span>
          <div class="verification-code" style="font-size: 1.85rem; font-weight: 900; letter-spacing: 0.18em; color: var(--brand-blue-dark); margin: 6px 0 4px;">482 915</div>
          <p style="margin: 0; color: var(--slate); font-size: 0.76rem; font-weight: 600; max-width: 320px;">The code verifies this simulated ticket only.</p>
        </div>
      </div>

      <div class="ticket-perforation"></div>

      <!-- Action Footer Buttons -->
      <footer class="ticket-actions">
        <button class="button button--primary button--small" type="button" onclick="toast('Digital ticket downloaded', 'success');">
          <i data-lucide="download"></i>Download Ticket
        </button>
        ${ticket.status === 'active' ? `
          <button class="button button--ghost button--small" type="button" onclick="${isModal ? 'closeTicketModal();' : ''} loadTracking();">
            <i data-lucide="navigation"></i>Track Travel
          </button>
        ` : `
          <button class="button button--primary button--small" type="button" style="background: var(--brand-blue-dark); color: #ffffff !important; border: none !important; box-shadow: none;" onclick="${isModal ? 'closeTicketModal();' : ''} navigate('book');">
            <i data-lucide="rotate-cw" style="color: #ffffff;"></i><span style="color: #ffffff !important;">Rebook Travel</span>
          </button>
        `}
        <button class="button button--ghost button--small" type="button" onclick="toast('Ticket link copied to clipboard', 'info');">
          <i data-lucide="share-2"></i>Share Ticket
        </button>
        ${isModal ? `
          <button class="button button--ghost button--small" type="button" onclick="closeTicketModal();">
            Close
          </button>
        ` : ''}
      </footer>
    </article>
  `;
}

function renderTicket() {
  const activeTicket = getTicketsData()[0];
  return `
    ${screenHead('Digital passenger ticket', 'Present the QR-style visual or six-digit verification code when boarding.', '<button class="button button--ghost" type="button" data-action="ticket-states"><i data-lucide="layers-3"></i>Preview States</button>')}
    ${renderDigitalTicketCard(activeTicket, false)}
  `;
}

function ticketField(label, value) { return `<div class="ticket-field"><span>${label}</span><strong>${value}</strong></div>`; }

function generateQrSvg(text = '482915', size = 140) {
  const matrixSize = 25;
  const moduleSize = size / matrixSize;
  
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  const pseudoRandom = (x, y) => {
    const val = Math.sin(x * 12.9898 + y * 78.233 + hash) * 43758.5453;
    return (val - Math.floor(val)) > 0.45;
  };

  const isModuleDark = (r, c) => {
    if (r <= 6 && c <= 6) {
      if (r === 0 || r === 6 || c === 0 || c === 6) return true;
      if (r >= 2 && r <= 4 && c >= 2 && c <= 4) return true;
      return false;
    }
    if (r <= 6 && c >= 18) {
      const cc = c - 18;
      if (r === 0 || r === 6 || cc === 0 || cc === 6) return true;
      if (r >= 2 && r <= 4 && cc >= 2 && cc <= 4) return true;
      return false;
    }
    if (r >= 18 && c <= 6) {
      const rr = r - 18;
      if (rr === 0 || rr === 6 || c === 0 || c === 6) return true;
      if (rr >= 2 && rr <= 4 && c >= 2 && c <= 4) return true;
      return false;
    }
    if ((r === 7 && c <= 7) || (c === 7 && r <= 7)) return false;
    if ((r === 7 && c >= 17) || (c === 17 && r <= 7)) return false;
    if ((r === 17 && c <= 7) || (c === 7 && r >= 17)) return false;

    if (r >= 16 && r <= 20 && c >= 16 && c <= 20) {
      const dr = r - 16, dc = c - 16;
      if (dr === 0 || dr === 4 || dc === 0 || dc === 4) return true;
      if (dr === 2 && dc === 2) return true;
      return false;
    }

    if (r === 6) return c % 2 === 0;
    if (c === 6) return r % 2 === 0;

    return pseudoRandom(r, c);
  };

  let rects = '';
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (isModuleDark(r, c)) {
        rects += `<rect x="${(c * moduleSize).toFixed(2)}" y="${(r * moduleSize).toFixed(2)}" width="${(moduleSize + 0.1).toFixed(2)}" height="${(moduleSize + 0.1).toFixed(2)}" fill="#0a0a0a"/>`;
      }
    }
  }

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="display:block; width:100%; height:100%; border-radius: 6px;">
    <rect width="${size}" height="${size}" fill="#ffffff"/>
    ${rects}
  </svg>`;
}

function generateQr(text, size) {
  return generateQrSvg(text || '482915', size || 136);
}

function renderTrips() {
  return `
    ${screenHead('My Travels', 'View upcoming, completed and cancelled passenger journeys.', '<button class="button button--primary" type="button" data-screen="book"><i data-lucide="plus"></i>Book a Travel</button>')}
    <div class="tabs" role="tablist"><button class="tab ${state.tripTab === 'upcoming' ? 'is-active' : ''}" type="button" data-action="trip-tab" data-value="upcoming">Upcoming</button><button class="tab ${state.tripTab === 'completed' ? 'is-active' : ''}" type="button" data-action="trip-tab" data-value="completed">Completed</button><button class="tab ${state.tripTab === 'cancelled' ? 'is-active' : ''}" type="button" data-action="trip-tab" data-value="cancelled">Cancelled</button></div>
    <section class="trip-list" style="margin-top:16px">${renderTripTabContent()}</section>`;
}

function renderTripTabContent() {
  if (state.tripTab === 'upcoming') {
    const date = new Date(`${state.bookingDate}T12:00:00`);
    const day = String(date.getDate()).padStart(2, '0');
    const month = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date).toUpperCase();
    const trip = state.activeTrip;
    return `
      ${tripCard(day,month,`${trip.boarding} → ${trip.destination}`,`${formatDemoDate(state.bookingDate)} · ${trip.depart}`,trip.plate,state.ticketStatus === 'cancelled' ? 'Cancelled' : 'Confirmed',displayReturnType(),bookingPaymentStatus(),'upcoming')}
      ${state.ticketType === 'return' ? tripCard('21','JUL',`${trip.destination} → ${trip.boarding}`,state.returnMode === 'date-specific' ? `${formatDemoDate(state.returnDate)} · departure to be chosen` : 'Open departure', 'Vehicle assigned at booking','Return Available',displayReturnType(),bookingPaymentStatus(),'upcoming') : ''}`;
  }
  if (state.tripTab === 'completed') {
    return `
      ${tripCard('16','JUL','Kampala → Entebbe','16 July 2026 · 6:30 PM','UBP 318F','Completed','One Way','UGX 5,000','completed')}
      ${tripCard('12','JUL','Entebbe → Kampala','12 July 2026 · 7:00 AM','UBN 742D','Completed','Return Package','UGX 9,000','completed')}`;
  }
  return `${tripCard('08','JUL','Entebbe → Kampala','Cancelled 8 July 2026','UBM 245K','Cancelled','One Way','Refund pending','cancelled')}<article class="card empty-state"><div><div class="empty-state__icon"><i data-lucide="calendar-x"></i></div><h3>No other cancelled travels</h3><p class="muted">Cancelled bookings and refund progress appear here.</p></div></article>`;
}

function tripCard(day, month, route, date, vehicle, status, type, payment, mode) {
  const statusClass = mode === 'completed' ? 'status-chip--success' : mode === 'cancelled' ? 'status-chip--danger' : 'status-chip--info';
  const actions = mode === 'upcoming'
    ? `<button class="button button--primary button--small" type="button" data-screen="ticket">View Ticket</button><button class="button button--ghost button--small" type="button" data-screen="tracking">Track Vehicle</button><button class="button button--ghost button--small" type="button" data-action="change-return">Change Return Date</button><button class="button button--ghost button--small" type="button" data-screen="support">Contact Support</button>`
    : mode === 'completed'
      ? `<button class="button button--primary button--small" type="button" data-action="rate-trip">Rate Travel</button><button class="button button--ghost button--small" type="button" data-screen="book">Book Again</button><button class="button button--ghost button--small" type="button" data-action="lost-item">Report Lost Item</button>`
      : `<button class="button button--ghost button--small" type="button" data-screen="support">View Support Reference</button><button class="button button--primary button--small" type="button" data-screen="book">Book Again</button>`;
  return `<article class="card trip-card"><div class="trip-date-block"><strong>${day}</strong><span>${month}</span></div><div><div class="card-head"><div><h3>${route}</h3><span class="muted text-small">${date}</span></div><span class="status-chip ${statusClass}">${status}</span></div><div class="trip-meta"><span><i data-lucide="bus-front"></i>${vehicle}</span><span><i data-lucide="ticket"></i>${type}</span><span><i data-lucide="credit-card"></i>${payment}</span></div>${mode === 'upcoming' ? '<div class="countdown" style="margin-top:10px"><i data-lucide="clock-3"></i>Boarding begins in 42 minutes</div>' : mode === 'cancelled' ? '<p class="muted text-small" style="margin:10px 0 0">Reason: Passenger cancelled · Support reference SUP-44720</p>' : ''}</div><div class="trip-card__actions">${actions}</div></article>`;
}

function getTicketsData() {
  if (!state.tickets) {
    state.tickets = [
      {
        id: 'TK-984210',
        route: 'Entebbe Bus Park → Kampala Railway Stage',
        cityA: 'Entebbe',
        cityB: 'Kampala',
        stageA: 'Entebbe Bus Park',
        stageB: 'Kampala Railway Stage',
        via: 'Via Kajansi Express',
        date: 'Today, 25 Jul 2026',
        time: '09:30 AM',
        seat: 'Seat 04',
        passenger: 'Christo I.',
        price: 'UGX 5,000',
        status: 'active',
        vanNumber: 'UBA 412X',
        driver: 'David Ssemwanga',
        avatar: 'assets/driver_1-branded.png',
        qrData: 'TAXIBEE|TK-984210|CHRISTO|ENT-KLA|SEAT04'
      },
      {
        id: 'TK-984288',
        route: 'Entebbe Bus Park → Nambole Stage',
        cityA: 'Entebbe',
        cityB: 'Nambole',
        stageA: 'Entebbe Bus Park',
        stageB: 'Nambole Stage',
        via: 'Via Northern Bypass',
        date: 'Tomorrow, 26 Jul 2026',
        time: '10:15 AM',
        seat: 'Seat 07',
        passenger: 'Christo I.',
        price: 'UGX 7,000',
        status: 'active',
        vanNumber: 'UBF 890Y',
        driver: 'John Ssekabira',
        avatar: 'assets/driver_3-branded.png',
        qrData: 'TAXIBEE|TK-984288|CHRISTO|ENT-NMB|SEAT07'
      },
      {
        id: 'TK-981105',
        route: 'Kampala Railway Stage → Entebbe Bus Park',
        cityA: 'Kampala',
        cityB: 'Entebbe',
        stageA: 'Kampala Railway Stage',
        stageB: 'Entebbe Bus Park',
        via: 'Via Busega Corridor',
        date: 'Yesterday, 24 Jul 2026',
        time: '05:00 PM',
        seat: 'Seat 12',
        passenger: 'Christo I.',
        price: 'UGX 5,000',
        status: 'used',
        vanNumber: 'UBC 104Z',
        driver: 'Moses Mukasa',
        avatar: 'assets/driver_2-branded.png',
        qrData: 'TAXIBEE|TK-981105|CHRISTO|KLA-ENT|SEAT12'
      },
      {
        id: 'TK-975420',
        route: 'Entebbe Bus Park → Mbarara Stage',
        cityA: 'Entebbe',
        cityB: 'Mbarara',
        stageA: 'Entebbe Bus Park',
        stageB: 'Mbarara Stage',
        via: 'Via Masaka Highway',
        date: '18 Jul 2026',
        time: '07:00 AM',
        seat: 'Seat 02',
        passenger: 'Christo I.',
        price: 'UGX 30,000',
        status: 'used',
        vanNumber: 'UBD 554W',
        driver: 'Godfrey Tumwesigye',
        avatar: 'assets/driver_4-branded.png',
        qrData: 'TAXIBEE|TK-975420|CHRISTO|ENT-MBR|SEAT02'
      },
      {
        id: 'TK-968912',
        route: 'Entebbe Bus Park → Masaka Stage',
        cityA: 'Entebbe',
        cityB: 'Masaka',
        stageA: 'Entebbe Bus Park',
        stageB: 'Masaka Stage',
        via: 'Via Masaka Road',
        date: '10 Jul 2026',
        time: '02:30 PM',
        seat: 'Seat 09',
        passenger: 'Christo I.',
        price: 'UGX 20,000',
        status: 'expired',
        vanNumber: 'UBE 712V',
        driver: 'Robert Kagimu',
        avatar: 'assets/driver_5-branded.png',
        qrData: 'TAXIBEE|TK-968912|CHRISTO|ENT-MSK|SEAT09'
      }
    ];
  }
  return state.tickets;
}

function renderTickets() {
  const tickets = getTicketsData();
  const filter = state.ticketsFilter || 'all';

  let filtered = tickets;
  if (filter === 'active') {
    filtered = tickets.filter(t => t.status === 'active');
  } else if (filter === 'used') {
    filtered = tickets.filter(t => t.status === 'used' || t.status === 'expired');
  }

  const activeCount = tickets.filter(t => t.status === 'active').length;
  const usedCount = tickets.filter(t => t.status === 'used' || t.status === 'expired').length;

  return `
    ${screenHead('My Tickets', 'Access your digital travel passes, scannable QR boarding codes, and journey history.')}
    
    <div class="tickets-container" style="max-width: 800px; margin: 16px auto 0;">
      <!-- Category Filter Tabs (Modern Tracking Page Tabs) -->
      <div class="tabs" role="tablist" style="margin-bottom: 20px;">
        <button class="tab ${filter === 'all' ? 'is-active' : ''}" type="button" data-action="filter-tickets" data-value="all">
          All Tickets (${tickets.length})
        </button>
        <button class="tab ${filter === 'active' ? 'is-active' : ''}" type="button" data-action="filter-tickets" data-value="active">
          Active (${activeCount})
        </button>
        <button class="tab ${filter === 'used' ? 'is-active' : ''}" type="button" data-action="filter-tickets" data-value="used">
          Expired (${usedCount})
        </button>
      </div>

      <!-- Tickets List -->
      ${filtered.length === 0 ? `
        <div class="card empty-state-card" style="text-align: center; padding: 48px 24px; background: white; border-radius: 24px; border: 1.5px dashed var(--border);">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--info-soft); color: var(--brand-blue); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
            <i data-lucide="ticket-x" style="width: 32px; height: 32px;"></i>
          </div>
          <h3 style="margin: 0 0 6px 0; font-size: 1.15rem; font-weight: 800; color: var(--brand-blue-dark);">No Tickets Found</h3>
          <p class="muted" style="margin: 0 0 20px 0; font-size: 0.88rem;">You have no ${filter} tickets at the moment.</p>
          <button class="btn btn--primary" type="button" onclick="navigate('book');">
            <i data-lucide="ticket-plus"></i> Book a Travel
          </button>
        </div>
      ` : `
        <div class="tickets-list">
          ${filtered.map(ticket => {
            const isExpired = ticket.status === 'used' || ticket.status === 'expired';
            const statusLabel = ticket.status === 'active' ? 'ACTIVE' : (ticket.status === 'used' ? 'USED' : 'EXPIRED');
            const statusBadgeClass = ticket.status === 'active' ? 'status-chip--success' : 'status-chip--neutral';
            
            return `
              <div class="ticket-card ${isExpired ? 'is-expired' : ''}">
                <!-- Header Bar -->
                <div class="ticket-card-header">
                  <strong style="font-size: 0.98rem; font-weight: 850;">${escapeHtml(ticket.route)}</strong>
                  <span class="status-chip ${statusBadgeClass}" style="font-size: 0.72rem; padding: 4px 12px; font-weight: 850; text-transform: uppercase;">${statusLabel}</span>
                </div>

                <!-- Body -->
                <div class="ticket-card-body">
                  <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; gap: 16px; margin-bottom: 12px; font-size: 0.84rem; flex-wrap: wrap;">
                      <div>
                        <span class="muted" style="font-size: 0.72rem; display: block; text-transform: uppercase; font-weight: 700;">Departure</span>
                        <strong style="color: var(--brand-blue-dark); font-weight: 850; font-size: 0.98rem;">${escapeHtml(ticket.time)}</strong>
                        <span class="muted" style="font-size: 0.78rem; display: block; font-weight: 600;">${escapeHtml(ticket.date)}</span>
                      </div>
                      <div style="border-left: 1.5px solid var(--border); padding-left: 14px;">
                        <span class="muted" style="font-size: 0.72rem; display: block; text-transform: uppercase; font-weight: 700;">Assigned Seat</span>
                        <strong style="color: var(--brand-blue); font-weight: 850; font-size: 0.98rem;">${escapeHtml(ticket.seat)}</strong>
                        <span class="muted" style="font-size: 0.78rem; display: block; font-weight: 600;">${escapeHtml(ticket.passenger)}</span>
                      </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 10px; font-size: 0.8rem; color: var(--slate); flex-wrap: wrap;">
                      <span>Via: <strong>${escapeHtml(ticket.via)}</strong></span>
                      <span>•</span>
                      <span>Vehicle: <strong>${escapeHtml(ticket.vanNumber)}</strong></span>
                    </div>
                  </div>

                  <!-- Interactive QR Code Preview Badge -->
                  <div class="ticket-qr-trigger" role="button" tabindex="0" onclick="showTicketDetailsModal('${ticket.id}');" style="cursor: pointer; text-align: center; background: #ffffff; padding: 6px 8px; border-radius: 16px; border: 1.5px solid var(--border); box-shadow: 0 2px 8px rgba(26,26,26,0.06); flex-shrink: 0; transition: all 0.2s ease; display: flex; flex-direction: column; align-items: center; justify-content: center;" title="Click to view full digital pass">
                    <div style="width: 46px; height: 46px;">
                      ${generateQrSvg(ticket.id, 46)}
                    </div>
                    <span style="display: block; font-size: 0.62rem; font-weight: 850; color: var(--brand-blue); margin-top: 3px; letter-spacing: 0.03em;">SCAN QR</span>
                  </div>
                </div>

                <!-- Perforated Cut-Out Divider Line -->
                <div class="ticket-card-divider">
                  <div class="ticket-card-notch-left"></div>
                  <div class="ticket-card-notch-right"></div>
                </div>

                <!-- Footer Bar -->
                <div class="ticket-card-footer">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 0.82rem; font-weight: 700; color: var(--slate);">Ticket ID: <strong style="color: var(--charcoal); font-weight: 850;">${escapeHtml(ticket.id)}</strong></span>
                    <strong style="color: var(--success); font-size: 0.98rem; font-weight: 850;">${escapeHtml(ticket.price)}</strong>
                  </div>

                  <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn--sm btn--outline" style="font-size: 0.82rem; font-weight: 800; border-radius: 12px; height: 38px; padding: 0 16px; display: inline-flex; align-items: center; gap: 6px;" onclick="showTicketDetailsModal('${ticket.id}');">
                      <i data-lucide="ticket" style="width: 16px; height: 16px;"></i> View
                    </button>
                    ${ticket.status === 'active' ? `
                      <button type="button" class="btn btn--sm btn--primary" style="font-size: 0.82rem; font-weight: 800; border-radius: 12px; height: 38px; padding: 0 16px; display: inline-flex; align-items: center; gap: 6px;" onclick="loadTracking();">
                        <i data-lucide="navigation" style="width: 16px; height: 16px;"></i> Track Van
                      </button>
                    ` : `
                      <button type="button" class="btn btn--sm btn--primary" style="font-size: 0.82rem; font-weight: 800; border-radius: 12px; height: 38px; padding: 0 16px; display: inline-flex; align-items: center; gap: 6px; background: var(--brand-blue-dark); color: #ffffff !important; border: none !important; box-shadow: none;" onclick="navigate('book');">
                        <i data-lucide="rotate-cw" style="width: 16px; height: 16px; color: #ffffff;"></i> <span style="color: #ffffff !important;">Rebook</span>
                      </button>
                    `}
                  </div>
                </div>

              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

function showTicketDetailsModal(ticketId) {
  const tickets = getTicketsData();
  const ticket = tickets.find(t => t.id === ticketId) || tickets[0];
  if (!ticket) return;

  const modalHtml = `
    <div class="modal-backdrop is-visible" id="ticket-modal-backdrop" onclick="closeTicketModal();" style="display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 9999;">
      <div class="modal-wrapper" onclick="event.stopPropagation();" style="max-width: 680px; width: 100%; max-height: 90vh; overflow-y: auto; border-radius: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.3);">
        ${renderDigitalTicketCard(ticket, true)}
      </div>
    </div>
  `;

  const existing = $('#ticket-modal-backdrop');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  refreshIcons();
}

function closeTicketModal() {
  const modal = $('#ticket-modal-backdrop');
  if (modal) modal.remove();
}
window.showTicketDetailsModal = showTicketDetailsModal;
window.closeTicketModal = closeTicketModal;

let liveTimer;
function startLiveProgress() {
  stopLiveProgress();

  let routeKey = state.selectedRoute || 'entebbe';
  if (state.activeTrip) {
    const boarding = state.activeTrip.boarding.toLowerCase();
    const destination = state.activeTrip.destination.toLowerCase();
    const rc = appData.routeCards.find(r => 
      (boarding.includes(r.cityA.toLowerCase()) && destination.includes(r.cityB.toLowerCase())) ||
      (boarding.includes(r.cityB.toLowerCase()) && destination.includes(r.cityA.toLowerCase()))
    );
    if (rc) routeKey = rc.key;
  }
  const isReverse = state.activeTrip ? state.activeTrip.boarding.toLowerCase().includes('kampala') || state.activeTrip.boarding.toLowerCase().includes('bweyogere') || state.activeTrip.boarding.toLowerCase().includes('busega') || state.activeTrip.boarding.toLowerCase().includes('nambole') || state.activeTrip.boarding.toLowerCase().includes('masaka') || state.activeTrip.boarding.toLowerCase().includes('lyantonde') || state.activeTrip.boarding.toLowerCase().includes('mbarara') : false;
  const points = getCurrentRoutePoints(routeKey, isReverse);
  
  const rc = appData.routeCards.find(r => r.key === routeKey) || appData.routeCards[0];
  const towns = isReverse ? rc.corridor.split(' \u2022 ').reverse() : rc.corridor.split(' \u2022 ');

  liveTimer = setInterval(() => {
    state.routeProgress = state.routeProgress >= 95 ? 20 : state.routeProgress + 2;
    
    $$('.live-progress-bar span').forEach(el => el.style.width = `${state.routeProgress}%`);
    const label = $('#live-progress-value'); if (label) label.textContent = `${state.routeProgress}%`;
    
    if (liveTravelMap && liveVehicleMarker) {
      const idx = Math.min(points.length - 1, Math.floor((state.routeProgress / 100) * points.length));
      liveVehicleMarker.setLatLng(points[idx]);
    }
    
    const currentTownIdx = Math.min(towns.length - 1, Math.floor((state.routeProgress / 100) * towns.length));
    const nextTownIdx = Math.min(towns.length - 1, currentTownIdx + 1);
    const metaRow = $('#live-trip-meta-row');
    if (metaRow) {
      metaRow.innerHTML = `<span><i data-lucide="map-pin" style="display:inline-block;width:12px;height:12px;vertical-align:middle;margin-right:3px;"></i>Current: ${towns[currentTownIdx]}</span><span><i data-lucide="flag" style="display:inline-block;width:12px;height:12px;vertical-align:middle;margin-right:3px;"></i>Next: ${towns[nextTownIdx]}</span>`;
      refreshIcons();
    }
  }, 1800);
}
function stopLiveProgress() { clearInterval(liveTimer); }

function renderLiveTrip() {
  return renderTracking();
}

function renderWallet() {
  const filters = [['all','All'],['deposit','Deposits'],['trip','Trip Payments'],['parcel','Parcel Payments'],['luggage','Luggage Payments'],['refund','Refunds'],['promotion','Promotions']];
  const transactions = appData.transactions.filter(tx => state.walletFilter === 'all' || tx.type === state.walletFilter);
  return `
    ${screenHead('Taxibee Wallet', 'Use demonstration funds for trips, parcels and luggage. This preview does not hold or process real money.', '<button class="button button--primary" type="button" data-action="open-add-funds"><i data-lucide="circle-plus"></i>Add Funds</button>')}
    <section class="wallet-hero card">
      <div class="card-head"><div><p class="section-kicker" style="color:rgba(255,255,255,.65)">Available balance</p><div class="wallet-balance" data-balance>${formatUGX(state.walletBalance)}</div><div class="wallet-account">Wallet 256 •••• 5678</div></div><i data-lucide="wallet-cards" style="width:38px;height:38px"></i></div>
      <div class="balance-grid"><div class="balance-cell"><small>Promotional balance</small><strong>UGX 2,000</strong></div><div class="balance-cell"><small>Pending refunds</small><strong>UGX 5,000</strong></div><div class="balance-cell"><small>Auto-Pay</small><strong>Off</strong></div></div>
      <div class="wallet-actions"><button class="wallet-action" type="button" data-action="open-add-funds"><i data-lucide="plus"></i><span>Add Funds</span></button><button class="wallet-action" type="button" data-action="send-passenger"><i data-lucide="send"></i><span>Send to Passenger</span></button><button class="wallet-action" type="button" data-screen="book"><i data-lucide="ticket"></i><span>Pay for Trip</span></button><button class="wallet-action" type="button" data-screen="parcel"><i data-lucide="package"></i><span>Pay for Parcel</span></button></div>
    </section>

    <section class="grid grid--sidebar" style="margin-top:18px">
      <div class="card"><div class="card-head"><div><p class="section-kicker">Transaction history</p><h2>Recent activity</h2></div><button class="button button--ghost button--small" type="button" data-action="download-demo"><i data-lucide="download"></i>Statement</button></div><div class="tabs">${filters.map(([value,label]) => `<button class="tab ${state.walletFilter === value ? 'is-active' : ''}" type="button" data-action="wallet-filter" data-value="${value}">${label}</button>`).join('')}</div><div class="transaction-list" style="margin-top:10px">${transactions.length ? transactions.map(renderTransaction).join('') : emptyState('receipt-text','No transactions in this filter','Try another wallet category.')}</div></div>
      <aside class="grid"><article class="card"><div class="card-head"><h3>Wallet preferences</h3><i data-lucide="settings-2"></i></div><div class="settings-list"><div class="settings-row"><span class="settings-row__icon"><i data-lucide="zap"></i></span><span class="settings-row__copy"><strong>Auto-Pay</strong><span>Automatically pay eligible trips</span></span><button class="switch" type="button" data-action="toggle-switch"><span></span></button></div><button class="settings-row" type="button" data-action="wallet-pin"><span class="settings-row__icon"><i data-lucide="key-round"></i></span><span class="settings-row__copy"><strong>Wallet PIN</strong><span>Change demonstration PIN</span></span><i data-lucide="chevron-right"></i></button><button class="settings-row" type="button" data-screen="luggage"><span class="settings-row__icon"><i data-lucide="luggage"></i></span><span class="settings-row__copy"><strong>Pay for luggage</strong><span>Register and pay for a luggage tag</span></span><i data-lucide="chevron-right"></i></button></div></article><div class="notice"><i data-lucide="info"></i><div><strong>Preview wallet</strong><div>Balances, deposits and transfers are visual demonstrations only and reset on refresh.</div></div></div></aside>
    </section>`;
}

function renderTransaction(tx) {
  return `<div class="transaction"><span class="transaction__icon"><i data-lucide="${tx.icon}"></i></span><span class="transaction__copy"><strong>${tx.title}</strong><span>${tx.date}</span></span><span class="transaction__amount ${tx.direction === 'in' ? 'text-success' : ''}">${tx.direction === 'in' ? '+' : '−'} ${formatUGX(tx.amount)}<small>${tx.direction === 'in' ? 'Credit' : 'Paid'}</small></span></div>`;
}

function renderParcelBooking() {
  const steps = ['Sender', 'Recipient', 'Parcel', 'Delivery'];
  const isWizardStep = state.parcelStep <= 4;

  return `
    ${screenHead('Send a parcel', 'Book a traceable stage-to-stage parcel delivery using demonstration data.')}
    
    ${isWizardStep ? `
      <!-- Horizontal progress bar for desktop -->
      <div class="flow-progress" aria-label="Parcel booking progress" style="max-width: 700px; margin: 0 auto 20px;">
        ${steps.map((label, index) => `
          <div class="flow-step ${state.parcelStep === index + 1 ? 'is-active' : state.parcelStep > index + 1 ? 'is-complete' : ''}">
            <span class="flow-step__number">${state.parcelStep > index + 1 ? '<i data-lucide="check"></i>' : index + 1}</span>
            <span>${label}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="parcel-booking-flow-container" style="max-width: 700px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; width: 100%;">
        <div class="card" style="width: 100%;">${renderParcelStep()}</div>
        <div class="notice" style="margin: 0; width: 100%; max-width: 100%; font-size: 0.8rem; padding: 14px 16px; border-radius: 18px; display: flex; align-items: start; gap: 12px;">
          <i data-lucide="package-check" style="width: 20px; height: 20px; flex-shrink: 0; color: var(--brand-blue); margin-top: 1px;"></i>
          <div>
            <strong style="font-size: 0.86rem; color: var(--brand-blue-dark); display: block; margin-bottom: 2px;">Parcel safety</strong>
            <div style="font-size: 0.8rem; color: var(--brand-blue-dark); line-height: 1.45;">Do not send prohibited, hazardous, unlawful or inadequately packaged items.</div>
          </div>
        </div>
      </div>
    ` : `
      <div class="parcel-checkout-flow-container" style="max-width: 700px; margin: 0 auto;">
        ${renderParcelStep()}
      </div>
    `}
  `;
}

function renderParcelStep() {
  const step = state.parcelStep;
  let body = '';

  if (step === 1) {
    body = `
      <div class="card-head"><div><h2>Sender details</h2></div></div>
      <div class="form-grid">
        <div class="field"><label for="parcel-sender-name">Full name</label><input id="parcel-sender-name" data-parcel-field="senderName" value="${escapeHtml(state.parcel.senderName)}"></div>
        <div class="field"><label for="parcel-sender-phone">Telephone number</label><input id="parcel-sender-phone" data-parcel-field="senderPhone" value="${escapeHtml(state.parcel.senderPhone)}"></div>
        <div class="field"><label for="parcel-pickup">Origin stage</label><select id="parcel-pickup" data-parcel-field="origin">${appData.routes.map(route => optionMarkup(route, state.parcel.origin)).join('')}</select></div>
        
        <!-- Pickup location along corridor -->
        <div class="field">
          <label for="parcel-pickup-location">Specific pickup point (Optional)</label>
          <select id="parcel-pickup-location" data-parcel-field="pickupLocation">
            <option value="" ${!state.parcel.pickupLocation ? 'selected' : ''}>Standard Stage Pickup (${escapeHtml(state.parcel.origin)})</option>
            ${appData.routes.filter(r => r !== state.parcel.origin).map(r => optionMarkup(r, state.parcel.pickupLocation)).join('')}
            <option value="__other__" ${state.parcel.pickupLocation === '__other__' ? 'selected' : ''}>Other – type your own</option>
          </select>
        </div>
        ${state.parcel.pickupLocation === '__other__' ? `
          <div class="field field--full" style="animation: slideDown 0.2s ease;">
            <label for="parcel-custom-pickup">Specify your pickup location</label>
            <input id="parcel-custom-pickup" data-parcel-field="customPickup" placeholder="e.g. Total Petrol Station, Entebbe Road" value="${escapeHtml(state.parcel.customPickup || '')}">
          </div>
        ` : ''}
      </div>
    `;
  }

  if (step === 2) {
    body = `
      <div class="card-head"><div><h2>Recipient details</h2></div></div>
      <div class="form-grid">
        <div class="field"><label for="parcel-recipient-name">Full name</label><input id="parcel-recipient-name" data-parcel-field="recipientName" value="${escapeHtml(state.parcel.recipientName)}"></div>
        <div class="field"><label for="parcel-recipient-phone">Telephone number</label><input id="parcel-recipient-phone" data-parcel-field="recipientPhone" value="${escapeHtml(state.parcel.recipientPhone)}"></div>
        <div class="field"><label for="parcel-destination">Destination stage</label><select id="parcel-destination" data-parcel-field="destination">${appData.routes.slice().reverse().map(route => optionMarkup(route, state.parcel.destination)).join('')}</select></div>
        
        <!-- Drop-off location along corridor -->
        <div class="field">
          <label for="parcel-dropoff-location">Specific drop-off point (Optional)</label>
          <select id="parcel-dropoff-location" data-parcel-field="dropoffLocation">
            <option value="" ${!state.parcel.dropoffLocation ? 'selected' : ''}>Standard Stage Drop-off (${escapeHtml(state.parcel.destination)})</option>
            ${appData.routes.filter(r => r !== state.parcel.destination).map(r => optionMarkup(r, state.parcel.dropoffLocation)).join('')}
            <option value="__other__" ${state.parcel.dropoffLocation === '__other__' ? 'selected' : ''}>Other – type your own</option>
          </select>
        </div>
        ${state.parcel.dropoffLocation === '__other__' ? `
          <div class="field field--full" style="animation: slideDown 0.2s ease;">
            <label for="parcel-custom-dropoff">Specify your drop-off location</label>
            <input id="parcel-custom-dropoff" data-parcel-field="customDropoff" placeholder="e.g. Shell Petrol Station, Jinja Road" value="${escapeHtml(state.parcel.customDropoff || '')}">
          </div>
        ` : ''}
      </div>
    `;
  }

  if (step === 3) {
    body = `
      <div class="card-head"><div><h2>Parcel information</h2></div></div>
      <div class="parcel-category-grid">
        ${['Documents','Small package','Medium package','Large package','Fragile item','Business parcel'].map((category,index) => `<button class="parcel-category ${state.parcelCategory === category ? 'is-selected' : ''}" type="button" data-action="parcel-category" data-value="${category}" aria-pressed="${state.parcelCategory === category}"><i data-lucide="${['file-text','package','package-open','boxes','glass-water','briefcase-business'][index]}"></i><span>${category}</span></button>`).join('')}
      </div>
      <div class="form-grid" style="margin-top:16px">
        <div class="field field--full"><label for="parcel-description">Description</label><input id="parcel-description" data-parcel-field="description" value="${escapeHtml(state.parcel.description)}"></div>
        <div class="field-row-4col" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; grid-column: 1 / -1;">
          <div class="field"><label for="parcel-weight">Approximate weight</label><select id="parcel-weight" data-parcel-field="weight">${['Under 1 kg','1–5 kg','5–10 kg'].map(value => optionMarkup(value, state.parcel.weight)).join('')}</select></div>
          <div class="field"><label for="parcel-quantity">Quantity</label><input id="parcel-quantity" data-parcel-field="quantity" type="number" value="${escapeHtml(state.parcel.quantity)}" min="1"></div>
          <div class="field"><label for="parcel-value">Declared value</label><input id="parcel-value" data-parcel-field="declaredValue" value="${escapeHtml(state.parcel.declaredValue)}"></div>
          <div class="field"><label for="parcel-fragile">Fragile handling</label><select id="parcel-fragile" data-parcel-field="fragile">${['No','Yes'].map(value => optionMarkup(value, state.parcel.fragile)).join('')}</select></div>
        </div>
        <div class="field field--full">
          <label for="parcel-departure">Preferred vehicle departure</label>
          <select id="parcel-departure" data-parcel-field="departure">
            ${['Next available vehicle','8:30 AM departure','9:00 AM departure','10:30 AM departure','12:00 PM departure','2:30 PM departure','4:00 PM departure'].map(value => optionMarkup(value, state.parcel.departure)).join('')}
          </select>
        </div>
        <div class="field field--full"><label for="parcel-instructions">Special instructions</label><textarea id="parcel-instructions" data-parcel-field="instructions">${escapeHtml(state.parcel.instructions)}</textarea></div>
        <div class="field field--full"><label>Photograph</label><div class="upload-box" data-action="upload-demo" role="button" tabindex="0"><div><i data-lucide="image-plus"></i><strong style="display:block">Add parcel photograph</strong><span>Visual placeholder only</span></div></div></div>
      </div>
    `;
  }

  if (step === 4) {
    body = `
      <div class="card-head"><div><h2>Delivery option</h2></div></div>
      <div class="radio-cards">
        ${[
          ['Standard Stage-to-Stage','Delivery on the next suitable vehicle · UGX 7,500','truck'],
          ['Priority Stage-to-Stage','Priority handling and earliest departure · UGX 10,000','badge-alert'],
          ['Hold for Collection','Hold securely at destination stage · UGX 8,000','package-check'],
          ['Future Last-Mile Delivery','Concept preview for future address delivery · UGX 12,000','map-pin-plus']
        ].map(item => `<label class="radio-card ${state.parcelDelivery === item[0] ? 'is-selected' : ''}"><input type="radio" name="parcel-delivery" value="${item[0]}" ${state.parcelDelivery === item[0] ? 'checked' : ''}><span class="radio-card__icon"><i data-lucide="${item[2]}"></i></span><span class="radio-card__body"><strong>${item[0]}</strong><span>${item[1]}</span></span></label>`).join('')}
      </div>
    `;
  }

  if (step === 5) {
    const total = parcelPrice();
    const isOpen = !!state.orderSummaryOpen;

    const pickupDisp = state.parcel.pickupLocation ? (state.parcel.pickupLocation === '__other__' ? (state.parcel.customPickup || 'Custom') : state.parcel.pickupLocation) : '';
    const dropoffDisp = state.parcel.dropoffLocation ? (state.parcel.dropoffLocation === '__other__' ? (state.parcel.customDropoff || 'Custom') : state.parcel.dropoffLocation) : '';

    const summaryListHtml = `
      <div class="detail-list">
        <div class="detail-row"><span>Sender</span><strong>${escapeHtml(state.parcel.senderName)}</strong></div>
        <div class="detail-row"><span>Recipient</span><strong>${escapeHtml(state.parcel.recipientName)}</strong></div>
        <div class="detail-row"><span>Origin stage</span><strong>${escapeHtml(state.parcel.origin)}${pickupDisp ? ` (${escapeHtml(pickupDisp)})` : ''}</strong></div>
        <div class="detail-row"><span>Destination stage</span><strong>${escapeHtml(state.parcel.destination)}${dropoffDisp ? ` (${escapeHtml(dropoffDisp)})` : ''}</strong></div>
        <div class="detail-row"><span>Category</span><strong>${state.parcelCategory}</strong></div>
        <div class="detail-row"><span>Departure</span><strong>${escapeHtml(state.parcel.departure || 'Next available vehicle')}</strong></div>
        <div class="detail-row"><span>Delivery option</span><strong>${state.parcelDelivery}</strong></div>
        <div class="detail-row"><span>Route charge</span><strong>${formatUGX(total - 1500)}</strong></div>
        <div class="detail-row"><span>Handling fee</span><strong>UGX 1,500</strong></div>
      </div>
    `;

    body = `
      <div class="checkout-unified-layout">
        <div class="shopify-summary-card mobile-summary-accordion ${isOpen ? 'is-open' : ''}">
          <div class="shopify-summary-header" data-action="toggle-order-summary" role="button" tabindex="0">
            <div class="shopify-summary-title">
              <i data-lucide="shopping-bag" style="width: 18px; height: 18px; color: var(--brand-blue-dark);"></i>
              <span>${isOpen ? 'Hide order summary' : 'Show order summary'}</span>
              <i data-lucide="chevron-down" class="shopify-accordion-arrow"></i>
            </div>
            <div class="shopify-summary-price">${formatUGX(total)}</div>
          </div>
          ${isOpen ? `
            <div class="shopify-summary-body">
              ${summaryListHtml}
              <div class="total-row" style="border-top: 2px solid var(--border); padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 850;">
                <span>Total Amount</span>
                <strong>${formatUGX(total)}</strong>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="checkout-grid-container">
          <div class="checkout-main-col">
            <div class="card-head"><div><h2 style="font-size: 1.15rem; font-weight: 850; color: var(--brand-blue-dark);">Parcel Payment</h2></div></div>
            ${renderStandardPaymentOptions(state.parcelPaymentMethod, 'parcel-payment-method', 'Pay the parcel desk before dispatch')}
            <div style="margin-top: 16px;">
              ${renderParcelPaymentPanel()}
            </div>
            <!-- Checkout action buttons placed inside left column -->
            <div class="button-row" style="margin-top:20px; display: flex; gap: 12px;">
              <button class="button button--ghost" type="button" data-action="parcel-back" style="flex: 0 0 80px;">Back</button>
              <button class="button button--golden-orange checkout-pay-btn" type="button" data-action="parcel-next" style="flex: 1;">
                <i data-lucide="package-check" style="width: 20px; height: 20px;"></i>
                <span>Complete Parcel Dispatch — ${formatUGX(total)}</span>
              </button>
            </div>
          </div>

          <aside class="checkout-sidebar-col">
            <div class="card checkout-summary-card">
              <div class="card-head" style="margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <i data-lucide="shopping-bag" style="width: 18px; height: 18px; color: var(--brand-blue-dark);"></i>
                  <h2 style="font-size: 1.1rem; font-weight: 850; color: var(--brand-blue-dark); margin: 0;">Parcel summary</h2>
                </div>
              </div>
              ${summaryListHtml}
              <div class="total-row" style="border-top: 2px solid var(--border); padding-top: 12px; margin-top: 12px; display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 850;">
                <span>Total Amount</span>
                <strong>${formatUGX(total)}</strong>
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;
  }

  if (step === 6) {
    const pickupDisp = state.parcel.pickupLocation ? (state.parcel.pickupLocation === '__other__' ? (state.parcel.customPickup || 'Custom') : state.parcel.pickupLocation) : '';
    const dropoffDisp = state.parcel.dropoffLocation ? (state.parcel.dropoffLocation === '__other__' ? (state.parcel.customDropoff || 'Custom') : state.parcel.dropoffLocation) : '';

    body = `
      <section class="success-screen" style="max-width: 600px; margin: 0 auto; text-align: center;">
        <div class="success-check"><i data-lucide="check"></i></div>
        <p class="eyebrow" style="text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; color: var(--success); margin-bottom: 4px;">Parcel Registered</p>
        <h1 style="font-size: 1.6rem; font-weight: 850; color: var(--brand-blue-dark); margin: 0 0 8px;">Ready for Handover</h1>
        <p class="muted" style="margin-bottom: 20px;">Tracking number <strong>#964201832-DL</strong> has been generated for your parcel.</p>
        
        <article class="card" style="text-align: left; padding: 20px; border-radius: 18px; margin-bottom: 20px;">
          <div class="detail-list">
            <div class="detail-row"><span>Tracking Number</span><strong>#964201832-DL</strong></div>
            <div class="detail-row"><span>Sender</span><strong>${escapeHtml(state.parcel.senderName)} (${escapeHtml(state.parcel.senderPhone)})</strong></div>
            <div class="detail-row"><span>Recipient</span><strong>${escapeHtml(state.parcel.recipientName)} (${escapeHtml(state.parcel.recipientPhone)})</strong></div>
            <div class="detail-row"><span>Origin Stage</span><strong>${escapeHtml(state.parcel.origin)}${pickupDisp ? ` (${escapeHtml(pickupDisp)})` : ''}</strong></div>
            <div class="detail-row"><span>Destination Stage</span><strong>${escapeHtml(state.parcel.destination)}${dropoffDisp ? ` (${escapeHtml(dropoffDisp)})` : ''}</strong></div>
            <div class="detail-row"><span>Preferred Departure</span><strong>${escapeHtml(state.parcel.departure || 'Next available vehicle')}</strong></div>
            <div class="detail-row"><span>Amount ${state.parcelPaymentMethod === 'cash' ? 'Due' : 'Paid'}</span><strong>${formatUGX(parcelPrice())}</strong></div>
            <div class="detail-row"><span>Payment Status</span><strong class="${state.parcelPaymentMethod === 'cash' ? 'text-warning' : 'text-success'}">${state.parcelPaymentMethod === 'cash' ? 'Payment Pending' : 'Paid'}</strong></div>
          </div>
        </article>

        <div class="button-row" style="justify-content: center; gap: 12px; flex-wrap: wrap;">
          <button class="button button--primary" type="button" data-screen="parcel-receipt"><i data-lucide="receipt"></i>View Receipt</button>
          <button class="button button--ghost" type="button" data-screen="trackparcel"><i data-lucide="package-search"></i>Track Parcel</button>
          <button class="button button--ghost" type="button" data-screen="home">Return Home</button>
        </div>
      </section>
    `;
  }

  const buttons = step <= 4 ? `
    <div class="button-row button-row--end" style="margin-top:20px">
      <button class="button button--ghost" type="button" data-action="parcel-back" ${step === 1 ? 'disabled' : ''}>Back</button>
      <button class="button button--primary" type="button" data-action="parcel-next">Continue</button>
    </div>
  ` : '';

  return `${body}${buttons}`;
}

function parcelPrice() {
  return ({ 'Standard Stage-to-Stage': 7500, 'Priority Stage-to-Stage': 10000, 'Hold for Collection': 8000, 'Future Last-Mile Delivery': 12000 })[state.parcelDelivery] || 7500;
}

function parcelPaymentChoice(value, title, copy, icon) {
  const selected = state.parcelPaymentMethod === value;
  return `<label class="radio-card ${selected ? 'is-selected' : ''}"><input type="radio" name="parcel-payment-method" value="${value}" ${selected ? 'checked' : ''}><span class="radio-card__icon"><i data-lucide="${icon}"></i></span><span class="radio-card__body"><strong>${title}</strong><span>${copy}</span></span></label>`;
}

function renderParcelPaymentPanel() {
  const method = state.parcelPaymentMethod;
  const total = parcelPrice();
  const walletRemaining = state.walletBalance - total;

  if (method === 'wallet') {
    return `<div class="payment-panel">
      <div class="grid grid--3" style="gap: 12px; margin-bottom: 4px;">
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Parcel Total</span>
          <strong style="font-size: 0.97rem; color: var(--brand-blue-dark);">${formatUGX(total)}</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Wallet Balance</span>
          <strong style="font-size: 0.97rem; color: var(--brand-blue-dark);">${formatUGX(state.walletBalance)}</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--page); border-radius: 10px; border: 1px solid var(--border);">
          <span class="muted text-small" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Remaining Balance</span>
          <strong class="${walletRemaining < 0 ? 'text-danger' : 'text-success'}" style="font-size: 0.97rem;">${formatUGX(walletRemaining)}</strong>
        </div>
      </div>
      <div class="field" style="margin-top:13px"><label for="parcel-wallet-pin">Wallet PIN</label><input id="parcel-wallet-pin" type="password" inputmode="numeric" maxlength="4" value="2580"><span class="field-help">Any four digits are accepted in this preview.</span></div>
    </div>`;
  }
  if (method === 'mobile' || method === 'mtn' || method === 'airtel') {
    if (state.parcelPaymentDemoState === 'success') return paymentState('success', 'Authorization successful', 'The simulated Mobile Money request was approved.', 'parcel-payment-reset');
    if (state.parcelPaymentDemoState === 'failed') return paymentState('failed', 'Authorization failed', 'The simulated request was declined.', 'parcel-payment-reset');
    return `<div class="payment-panel"><div class="form-grid"><div class="field"><label>Operator</label><select id="parcel-mobile-operator" style="padding: 8px; border-radius: 8px; border: 1px solid var(--border); width: 100%;"><option ${method === 'airtel' ? '' : 'selected'}>MTN MoMo</option><option ${method === 'airtel' ? 'selected' : ''}>Airtel Money</option></select></div><div class="field"><label for="parcel-mobile-number">Mobile Money number</label><input id="parcel-mobile-number" value="${escapeHtml(state.parcel.senderPhone)}"></div></div><div class="button-row" style="margin-top:13px"><button class="button button--success button--small" type="button" data-action="parcel-payment-state" data-value="success">Simulate Success</button><button class="button button--soft-red button--small" type="button" data-action="parcel-payment-state" data-value="failed">Simulate Failure</button></div></div>`;
  }
  if (method === 'cash') {
    return `<div class="payment-panel"><div class="notice"><i data-lucide="clock-3"></i><div><strong>Payment due at the parcel desk.</strong><div>The parcel remains registered but will not dispatch until the simulated cash payment is confirmed.</div></div></div></div>`;
  }
  if (method === 'corporate') {
    return `<div class="payment-panel"><div class="field"><label for="parcel-corporate-ref">Corporate account reference</label><input id="parcel-corporate-ref" value="TAXIBEE-CORP-PARCEL-12"></div><p class="muted text-small">Parcel charges will be billed directly to your corporate account.</p></div>`;
  }
  return `<div class="payment-panel"><div class="field"><label for="parcel-voucher-code">Promotional voucher</label><input id="parcel-voucher-code" value="${state.parcelVoucherApplied ? 'PARCEL2000' : ''}" placeholder="Enter PARCEL2000"></div><button class="button button--secondary button--small" style="margin-top:10px" type="button" data-action="apply-parcel-voucher">Apply Demo Voucher</button><p class="muted text-small" style="margin-top:10px">A voucher reduces the total; choose another method to pay the balance.</p></div>`;
}

function advanceParcel() {
  if (state.parcelStep === 1 && (!state.parcel.senderName.trim() || !state.parcel.senderPhone.trim())) return toast('Enter the sender name and telephone number.', 'danger');
  if (state.parcelStep === 2 && (!state.parcel.recipientName.trim() || !state.parcel.recipientPhone.trim())) return toast('Enter the recipient name and telephone number.', 'danger');
  if (state.parcelStep === 3 && (!state.parcel.description.trim() || Number(state.parcel.quantity) < 1)) return toast('Describe the parcel and enter a valid quantity.', 'danger');
  if (state.parcelStep === 4 && state.parcel.origin === state.parcel.destination) return toast('Choose different origin and destination stages.', 'danger');
  if (state.parcelStep === 5) {
    if (state.parcelPaymentMethod === 'wallet' && !/^\d{4}$/.test($('#parcel-wallet-pin')?.value.trim() || '')) return toast('Enter any four digits for the demonstration wallet PIN.', 'danger');
    if (state.parcelPaymentMethod === 'wallet' && parcelPrice() > state.walletBalance) return toast('The demonstration wallet balance is insufficient. Choose another payment method.', 'danger');
    if (state.parcelPaymentMethod === 'mobile' && state.parcelPaymentDemoState !== 'success') return toast('Simulate a successful mobile-money response before confirming.', 'danger');
  }
  state.parcelStep = Math.min(6, state.parcelStep + 1);
  renderCurrentScreen(false);
  const heading = $('#main-content h2');
  if (heading) { heading.setAttribute('tabindex', '-1'); setTimeout(() => heading.focus({ preventScroll: true }), 20); }
  if (state.parcelStep === 6) toast('Parcel registered in demonstration mode.', 'success');
}

function renderParcelReceipt() {
  return `
    ${screenHead('Parcel receipt', 'Use this receipt to demonstrate parcel custody, tracking and collection verification.')}
    <article class="digital-ticket" style="max-width: 780px; margin: 0 auto;">
      <header class="ticket-header">
        <div class="ticket-brand">
          <div class="logo-frame logo-frame--ticket"><img src="assets/peebee-logo.svg" alt="Taxibee logo"></div>
          <div><h2>Taxibee Parcel</h2><p>Stage-to-Stage Digital Receipt</p></div>
        </div>
      </header>
      <div class="ticket-body">
        <div class="ticket-route">
          <div class="ticket-route__place"><span>ORIGIN</span><strong>${escapeHtml(state.parcel.origin)}</strong><span>Main Stage</span></div>
          <div class="ticket-route__arrow"><i data-lucide="arrow-right"></i></div>
          <div class="ticket-route__place"><span>DESTINATION</span><strong>${escapeHtml(state.parcel.destination)}</strong><span>Main Stage</span></div>
        </div>
        <div class="ticket-grid">
          ${ticketField('Tracking number','#964201832-DL')}
          ${ticketField('Sender',escapeHtml(state.parcel.senderName))}
          ${ticketField('Sender telephone',escapeHtml(state.parcel.senderPhone))}
          ${ticketField('Recipient',escapeHtml(state.parcel.recipientName))}
          ${ticketField('Recipient telephone',escapeHtml(state.parcel.recipientPhone))}
          ${ticketField('Parcel category',state.parcelCategory)}
          ${ticketField('Delivery option',state.parcelDelivery)}
          ${ticketField('Preferred departure',escapeHtml(state.parcel.departure || 'Next available vehicle'))}
          ${ticketField('Payment method',paymentLabel(state.parcelPaymentMethod))}
          ${ticketField('Amount ' + (state.parcelPaymentMethod === 'cash' ? 'due' : 'paid'), formatUGX(parcelPrice()))}
        </div>
        <div class="ticket-code-area">
          <div id="parcel-qr" class="ticket-qr-real" aria-label="Parcel QR code"><div class="qr-code">${generateQr()}</div></div>
          <div>
            <p class="section-kicker">Collection PIN</p>
            <div class="verification-code">742 915</div>
            <p class="muted text-small">Recipient should present this PIN & QR code with identification.</p>
          </div>
        </div>
        <div class="notice" style="margin-top:18px">
          <i data-lucide="shield-check"></i>
          <div>
            <strong>Collection safety</strong>
            <div>Do not share the collection PIN or QR code publicly. Inspect the parcel before leaving the collection desk.</div>
          </div>
        </div>
      </div>
      <div class="ticket-perforation"></div>
      <footer class="ticket-actions">
        <button class="button button--primary button--small" type="button" data-screen="trackparcel"><i data-lucide="package-search"></i>Track Parcel</button>
        <button class="button button--ghost button--small" type="button" data-action="share-demo"><i data-lucide="share-2"></i>Share Tracking</button>
        <button class="button button--ghost button--small" type="button" data-screen="support"><i data-lucide="headphones"></i>Contact Parcel Desk</button>
        <button class="button button--ghost button--small" type="button" data-screen="home">Return Home</button>
      </footer>
    </article>`;
}

function generateBarcode() {
  return [3,1,5,2,1,4,2,6,1,3,5,1,2,4,1,6,2,3,1,5,2,4,1,3,6,1,2,5,3,1,4,2].map(width => `<i style="width:${width}px"></i>`).join('');
}

function calculateSpecialHirePrice() {
  const sh = state.specialHire;
  const isCustom = sh.destinationType === 'custom';
  
  let basePrice = 0;
  let driverAllowance = 50000 * sh.durationDays;
  let fuelFee = 0;
  
  if (isCustom) {
    const dailyRates = { sedan: 100000, noah: 150000, minivan: 180000, commuter: 220000, highroof: 300000, coaster: 600000 };
    basePrice = (dailyRates[sh.vehicleType] || 300000) * sh.durationDays;
    fuelFee = 150000 * sh.durationDays;
  } else {
    const routeRates = {
      kajansi: { sedan: 50000, noah: 70000, minivan: 90000, commuter: 110000, highroof: 150000, coaster: 300000 },
      busega: { sedan: 50000, noah: 70000, minivan: 90000, commuter: 110000, highroof: 150000, coaster: 300000 },
      nambole: { sedan: 60000, noah: 80000, minivan: 100000, commuter: 130000, highroof: 180000, coaster: 350000 },
      masaka: { sedan: 180000, noah: 200000, minivan: 250000, commuter: 320000, highroof: 400000, coaster: 700000 },
      lyantonde: { sedan: 220000, noah: 260000, minivan: 320000, commuter: 400000, highroof: 500000, coaster: 850000 },
      mbarara: { sedan: 280000, noah: 320000, minivan: 380000, commuter: 480000, highroof: 600000, coaster: 1000000 }
    };
    const rate = routeRates[sh.standardRoute] || routeRates.kajansi;
    basePrice = rate[sh.vehicleType] || 150000;
    fuelFee = basePrice * 0.3;
    basePrice = basePrice * 0.7;
  }
  
  if (sh.driverType === 'tour') {
    driverAllowance += 30000 * sh.durationDays;
  }
  
  const subtotal = basePrice + driverAllowance + fuelFee;
  const tax = subtotal * 0.18;
  const total = subtotal + tax;
  
  return {
    basePrice: Math.round(basePrice),
    driverAllowance: Math.round(driverAllowance),
    fuelFee: Math.round(fuelFee),
    tax: Math.round(tax),
    total: Math.round(total)
  };
}

function renderSpecialHire() {
  const sh = state.specialHire;
  const step = sh.step;
  const vehicleLabels = {
    sedan: 'Saloon Car / Sedan (4 Seats)',
    noah: 'Toyota Noah (7 Seats)',
    minivan: 'Alphard / Multi-Seater (10 Seats)',
    commuter: 'Commuter (14)',
    highroof: 'Highroof (18)',
    coaster: 'Executive Coaster (30 Seats)'
  };
  
  if (step === 1) {
    const chosenVehicle = appData.specialHireVehicles.find(v => v.id === (sh.vehicleType || sh.vehicleId)) || appData.specialHireVehicles[0];

    const hireVehiclesList = [
      { id: 'sedan', name: 'Saloon Car / Sedan (4 Seats)', desc: 'Perfect for solo business travelers, couples, or small private trips.', price: 100000, img: state.transparentVehicles['assets/taxibee-sedan-branded.png'] || 'assets/taxibee-sedan-branded.png' },
      { id: 'noah', name: 'Toyota Noah (7 Seats)', desc: 'Versatile and spacious mid-size vehicle for family or small groups.', price: 150000, img: state.transparentVehicles['assets/taxibee-noah-branded.png'] || 'assets/taxibee-noah-branded.png' },
      { id: 'minivan', name: 'Alphard / Multi-Seater (10 Seats)', desc: 'Comfortable vehicle for family travel or small business delegates.', price: 180000, img: state.transparentVehicles['assets/taxibee-minivan-branded.png'] || 'assets/taxibee-minivan-branded.png' },
      { id: 'commuter', name: 'Commuter (14 Seats)', desc: 'Standard roof, spacious, ideal for daily commutes or standard group travel.', price: 220000, img: state.transparentVehicles['assets/taxibee-van.png'] || 'assets/taxibee-van.png' },
      { id: 'highroof', name: 'Highroof (18 Seats)', desc: 'High roof version for extra headroom, maximum ventilation, and luggage space.', price: 300000, img: state.transparentVehicles['assets/taxibee-highroof-branded.png'] || 'assets/taxibee-highroof-branded.png' },
      { id: 'coaster', name: 'Executive Coaster (30 Seats)', desc: 'Spacious luxury coaster for big company excursions or large events.', price: 600000, img: state.transparentVehicles['assets/taxibee-coaster-branded.png'] || 'assets/taxibee-coaster-branded.png' }
    ];

    return `
      ${screenHead('Private Charter & Special Hire', 'Choose your vehicle type and enter your charter destination.')}
      
      <div class="special-hire-step1-layout" style="margin-top: 16px;">
        <!-- Left Main Column: Vehicle Selection Grid -->
        <div class="special-hire-main-col">
          <h2 style="font-size: 1.1rem; font-weight: 800; margin-bottom: 14px; color: var(--brand-blue-dark);">1. Select Vehicle Type</h2>
          <div class="vehicle-card-grid">
            ${hireVehiclesList.map(v => {
              const isSelected = sh.vehicleType === v.id;
              return `
                <div class="card vehicle-card ${isSelected ? 'is-selected' : ''}" data-action="select-hire-vehicle" data-value="${v.id}" role="button" tabindex="0" style="cursor: pointer; border: 2px solid ${isSelected ? 'var(--brand-blue)' : 'var(--border)'}; background: ${isSelected ? 'var(--info-soft)' : 'white'}; padding: 18px; border-radius: 18px; transition: all 0.22s ease;">
                  
                  <!-- Standard View (Always visible on Desktop, visible on Mobile when unselected) -->
                  <div class="vehicle-card__standard-view">
                    <div>
                      <img src="${v.img}" alt="${escapeHtml(v.name)}" style="width: 100%; height: 125px; object-fit: contain; margin-bottom: 12px;">
                      <h3 style="margin: 0; font-size: 1.02rem; font-weight: 800; color: var(--brand-blue-dark);">${escapeHtml(v.name)}</h3>
                      <p class="muted" style="font-size: 0.82rem; margin: 4px 0 14px; line-height: 1.4;">${escapeHtml(v.desc)}</p>
                    </div>
                    <div style="display: flex; justify-content: flex-start; align-items: center; border-top: 1px solid var(--border); padding-top: 12px;">
                      <strong style="color: var(--success); font-size: 1.05rem; font-weight: 850;">${formatUGX(v.price)} / day</strong>
                    </div>
                  </div>

                  <!-- Mobile In-Card Inline Form (Visible ONLY on Mobile when Selected) -->
                  ${isSelected ? `
                    <div class="vehicle-card__mobile-inline-form" onclick="event.stopPropagation();">
                      <!-- Selected Vehicle Header Banner -->
                      <div class="mobile-hire-selected-banner" style="background: rgba(26,26,26, 0.07); border: 1px solid rgba(26,26,26, 0.15); border-radius: 16px; padding: 12px; display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
                        <img src="${v.img}" alt="${escapeHtml(v.name)}" style="width: 58px; height: 44px; object-fit: contain; flex-shrink: 0;" />
                        <div>
                          <span style="font-size: 0.68rem; text-transform: uppercase; font-weight: 800; color: var(--brand-blue); letter-spacing: 0.05em; display: block;">SELECTED VEHICLE</span>
                          <strong style="font-size: 0.98rem; font-weight: 850; color: var(--brand-blue-dark); display: block; line-height: 1.25;">${escapeHtml(v.name)}</strong>
                          <span style="color: var(--success); font-size: 0.88rem; font-weight: 850; display: block; margin-top: 2px;">${formatUGX(v.price)} / day</span>
                        </div>
                      </div>

                      <!-- 2. Route & Destination Section -->
                      <div style="margin-top: 4px;">
                        <h3 style="font-size: 1.02rem; font-weight: 850; margin: 0 0 10px 0; color: var(--brand-blue-dark);">2. Route &amp; Destination</h3>
                        
                        <!-- Choice Pills -->
                        <div class="choice-pills" style="display: flex; gap: 6px; margin-bottom: 12px; width: 100%;">
                          <button class="choice-pill ${sh.destinationType === 'standard' ? 'is-active' : ''}" type="button" data-action="select-hire-dest-type" data-value="standard" style="flex: 1; text-align: center; font-size: 0.78rem; padding: 7px 10px; font-weight: 750;">Standard Route</button>
                          <button class="choice-pill ${sh.destinationType === 'custom' ? 'is-active' : ''}" type="button" data-action="select-hire-dest-type" data-value="custom" style="flex: 1; text-align: center; font-size: 0.78rem; padding: 7px 10px; font-weight: 750;">Custom Destination</button>
                        </div>

                        ${sh.destinationType === 'standard' ? `
                          <div class="field" style="margin: 0;">
                            <label for="hire-route-select-mobile" style="font-size: 0.78rem; font-weight: 700; color: var(--slate); margin-bottom: 4px; display: block;">Select Corridor Route</label>
                            <select id="hire-route-select-mobile" data-hire-field="standardRoute" style="padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-strong); width: 100%; font-weight: 650; font-size: 0.88rem; background: white;">
                              <option value="kajansi" ${sh.standardRoute === 'kajansi' ? 'selected' : ''}>Entebbe – Kampala (Via Kajansi)</option>
                              <option value="busega" ${sh.standardRoute === 'busega' ? 'selected' : ''}>Entebbe – Kampala (Via Busega)</option>
                              <option value="nambole" ${sh.standardRoute === 'nambole' ? 'selected' : ''}>Entebbe – Nambole</option>
                              <option value="masaka" ${sh.standardRoute === 'masaka' ? 'selected' : ''}>Entebbe – Masaka</option>
                              <option value="lyantonde" ${sh.standardRoute === 'lyantonde' ? 'selected' : ''}>Entebbe – Lyantonde</option>
                              <option value="mbarara" ${sh.standardRoute === 'mbarara' ? 'selected' : ''}>Entebbe – Mbarara</option>
                            </select>
                          </div>
                        ` : `
                          <div class="field" style="margin: 0;">
                            <label for="hire-custom-dest-mobile" style="font-size: 0.78rem; font-weight: 700; color: var(--slate); margin-bottom: 4px; display: block;">Destination in Uganda</label>
                            <input id="hire-custom-dest-mobile" type="text" data-hire-field="customDestination" value="${escapeHtml(sh.customDestination)}" placeholder="e.g. Jinja town, Fort Portal, Kabale" style="padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-strong); width: 100%; font-weight: 650; font-size: 0.88rem;">
                          </div>
                        `}
                      </div>

                      <!-- Primary Action CTA Button -->
                      <button class="button button--primary w-full" type="button" data-action="special-hire-next" style="margin-top: 16px; padding: 14px; border-radius: 14px; font-weight: 850; font-size: 0.98rem; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        Continue to Details →
                      </button>
                    </div>
                  ` : ''}

                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Right Sidebar Column (Desktop view) -->
        <aside class="special-hire-sidebar-col">
          <div class="special-hire-sidebar-card">
            
            <!-- Selected Vehicle Mini Preview Banner -->
            <div class="sidebar-vehicle-preview">
              <img src="${chosenVehicle.img}" alt="${escapeHtml(chosenVehicle.name)}" />
              <div>
                <span style="font-size: 0.68rem; text-transform: uppercase; font-weight: 750; color: var(--brand-blue); letter-spacing: 0.05em; display: block;">Selected Vehicle</span>
                <h4>${escapeHtml(chosenVehicle.name)}</h4>
                <strong class="price-tag">${formatUGX(chosenVehicle.dailyRate)} / day</strong>
              </div>
            </div>

            <!-- Sleek Route & Destination Form -->
            <div class="sidebar-route-section" style="margin-top: 4px;">
              <h3 style="font-size: 1rem; font-weight: 850; margin: 0 0 10px 0; color: var(--brand-blue-dark);">2. Route &amp; Destination</h3>
              
              <!-- Choice Pills -->
              <div class="choice-pills" style="display: flex; gap: 6px; margin-bottom: 12px; width: 100%;">
                <button class="choice-pill ${sh.destinationType === 'standard' ? 'is-active' : ''}" type="button" data-action="select-hire-dest-type" data-value="standard" style="flex: 1; text-align: center; font-size: 0.78rem; padding: 6px 10px;">Standard Route</button>
                <button class="choice-pill ${sh.destinationType === 'custom' ? 'is-active' : ''}" type="button" data-action="select-hire-dest-type" data-value="custom" style="flex: 1; text-align: center; font-size: 0.78rem; padding: 6px 10px;">Custom Destination</button>
              </div>

              ${sh.destinationType === 'standard' ? `
                <div class="field" style="margin: 0;">
                  <label for="hire-route-select" style="font-size: 0.78rem; font-weight: 700; color: var(--slate); margin-bottom: 4px; display: block;">Select Corridor Route</label>
                  <select id="hire-route-select" data-hire-field="standardRoute" style="padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-strong); width: 100%; font-weight: 650; font-size: 0.88rem; background: white;">
                    <option value="kajansi" ${sh.standardRoute === 'kajansi' ? 'selected' : ''}>Entebbe – Kampala (Via Kajansi)</option>
                    <option value="busega" ${sh.standardRoute === 'busega' ? 'selected' : ''}>Entebbe – Kampala (Via Busega)</option>
                    <option value="nambole" ${sh.standardRoute === 'nambole' ? 'selected' : ''}>Entebbe – Nambole</option>
                    <option value="masaka" ${sh.standardRoute === 'masaka' ? 'selected' : ''}>Entebbe – Masaka</option>
                    <option value="lyantonde" ${sh.standardRoute === 'lyantonde' ? 'selected' : ''}>Entebbe – Lyantonde</option>
                    <option value="mbarara" ${sh.standardRoute === 'mbarara' ? 'selected' : ''}>Entebbe – Mbarara</option>
                  </select>
                </div>
              ` : `
                <div class="field" style="margin: 0;">
                  <label for="hire-custom-dest" style="font-size: 0.78rem; font-weight: 700; color: var(--slate); margin-bottom: 4px; display: block;">Destination in Uganda</label>
                  <input id="hire-custom-dest" type="text" data-hire-field="customDestination" value="${escapeHtml(sh.customDestination)}" placeholder="e.g. Jinja town, Fort Portal, Kabale" style="padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border-strong); width: 100%; font-weight: 650; font-size: 0.88rem;">
                </div>
              `}
            </div>

            <!-- Primary Action CTA Button -->
            <button class="button button--primary w-full" type="button" data-action="special-hire-next" style="margin-top: 14px; padding: 12px; font-weight: 800; font-size: 0.95rem;">
              Continue to Details →
            </button>
          </div>
        </aside>
      </div>
    `;
  }
  
  if (step === 2) {
    const chosenVehicle = appData.specialHireVehicles.find(v => v.id === (sh.vehicleType || sh.vehicleId)) || appData.specialHireVehicles[0];
    const days = sh.durationDays || 1;
    const priceDetails = calculateSpecialHirePrice();

    return `
      ${screenHead('Private Charter & Special Hire', 'Enter your charter specifications and driver preferences.')}
      
      <div class="special-hire-flow-container" style="display: flex; flex-direction: column; gap: 20px; max-width: 700px; margin: 0 auto;">
        
        <!-- Selection Summary Bar -->
        <div style="background: var(--info-soft); border: 1px solid rgba(26, 26, 26,0.12); padding: 14px 18px; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="${chosenVehicle.img}" alt="${chosenVehicle.name}" style="width: 52px; height: 40px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border);" />
            <div>
              <strong style="font-size: 0.94rem; color: var(--brand-blue-dark); display: block;">${chosenVehicle.name}</strong>
              <span style="font-size: 0.8rem; color: var(--slate); font-weight: 500;">Route: <strong>${sh.destinationType === 'custom' ? (sh.customDestination || 'Custom Corridor') : (sh.route || 'Entebbe Corridor')}</strong></span>
            </div>
          </div>
          <button class="button button--ghost button--small" type="button" data-action="special-hire-back" style="font-weight: 700; font-size: 0.8rem;">Change Vehicle</button>
        </div>

        <!-- Main Specifications Card -->
        <section class="card" style="margin: 0; padding: 24px; display: flex; flex-direction: column; gap: 24px; border-radius: 20px;">
          
          <!-- 1. Charter Date & Duration Row -->
          <div>
            <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 800; color: var(--brand-red); letter-spacing: 0.05em; display: block; margin-bottom: 4px;">Schedule</span>
            <h2 style="font-size: 1.15rem; font-weight: 800; margin: 0 0 16px 0; color: var(--brand-blue-dark);">Date &amp; Hire Duration</h2>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; align-items: start;">
              <!-- Date Input -->
              <div class="field" style="margin: 0;">
                <label style="font-weight: 750; font-size: 0.85rem; color: var(--charcoal); margin-bottom: 6px; display: block;">Start Charter Date</label>
                <div style="position: relative;">
                  <input type="date" data-hire-field="date" value="${sh.date}" style="padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border-strong); width: 100%; font-weight: 700; color: var(--brand-blue-dark); font-size: 0.95rem; outline: none; background: white;">
                </div>
              </div>

              <!-- Duration Numeric Stepper -->
              <div class="field" style="margin: 0;">
                <label style="font-weight: 750; font-size: 0.85rem; color: var(--charcoal); margin-bottom: 6px; display: block;">Duration of Hire</label>
                <div style="display: flex; align-items: center;">
                  <div style="display: flex; align-items: center; border: 1px solid var(--border-strong); border-radius: 12px; background: white; padding: 6px 10px; width: 100%; justify-content: space-between; height: 46px; box-sizing: border-box;">
                    <button class="button button--ghost" type="button" data-action="decrement-hire-days" style="width: 28px; height: 28px; border-radius: 7px; font-weight: 800; font-size: 1rem; display: grid; place-items: center; padding: 0; min-width: 28px; flex-shrink: 0;">-</button>
                    <span style="font-weight: 750; font-size: 0.95rem; color: var(--brand-blue-dark);">${days} Day${days === 1 ? '' : 's'}</span>
                    <button class="button button--ghost" type="button" data-action="increment-hire-days" style="width: 28px; height: 28px; border-radius: 7px; font-weight: 800; font-size: 1rem; display: grid; place-items: center; padding: 0; min-width: 28px; flex-shrink: 0;">+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <hr style="border: 0; border-top: 1px solid var(--border); margin: 0;" />

          <!-- 2. Client Category (Rich Interactive Choice Tiles) -->
          <div>
            <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 800; color: var(--brand-red); letter-spacing: 0.05em; display: block; margin-bottom: 4px;">Account Category</span>
            <h2 style="font-size: 1.15rem; font-weight: 800; margin: 0 0 14px 0; color: var(--brand-blue-dark);">Charter Client Type</h2>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px;">
              <!-- Option A: Individual -->
              <div class="choice-tile ${sh.hireType === 'individual' ? 'is-selected' : ''}" data-action="select-hire-user-type" data-value="individual" style="padding: 16px; border-radius: 16px; border: 2px solid ${sh.hireType === 'individual' ? 'var(--brand-blue)' : 'var(--border)'}; background: ${sh.hireType === 'individual' ? 'rgba(26, 26, 26,0.03)' : 'white'}; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: flex-start; gap: 12px;">
                <div style="width: 42px; height: 42px; border-radius: 12px; background: ${sh.hireType === 'individual' ? 'var(--brand-blue)' : 'var(--surface-alt)'}; color: ${sh.hireType === 'individual' ? 'white' : 'var(--slate)'}; display: grid; place-items: center; flex-shrink: 0;">
                  <i data-lucide="users" style="width: 20px; height: 20px;"></i>
                </div>
                <div style="flex: 1;">
                  <strong style="font-size: 0.98rem; color: var(--brand-blue-dark); display: block; margin-bottom: 2px;">Individual &amp; Family</strong>
                  <span style="font-size: 0.8rem; color: var(--slate); line-height: 1.35; display: block;">Personal trips, family functions, airport transfers</span>
                </div>
              </div>

              <!-- Option B: Corporate -->
              <div class="choice-tile ${sh.hireType === 'company' ? 'is-selected' : ''}" data-action="select-hire-user-type" data-value="company" style="padding: 16px; border-radius: 16px; border: 2px solid ${sh.hireType === 'company' ? 'var(--brand-blue)' : 'var(--border)'}; background: ${sh.hireType === 'company' ? 'rgba(26, 26, 26,0.03)' : 'white'}; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: flex-start; gap: 12px;">
                <div style="width: 42px; height: 42px; border-radius: 12px; background: ${sh.hireType === 'company' ? 'var(--brand-blue)' : 'var(--surface-alt)'}; color: ${sh.hireType === 'company' ? 'white' : 'var(--slate)'}; display: grid; place-items: center; flex-shrink: 0;">
                  <i data-lucide="building-2" style="width: 20px; height: 20px;"></i>
                </div>
                <div style="flex: 1;">
                  <strong style="font-size: 0.98rem; color: var(--brand-blue-dark); display: block; margin-bottom: 2px;">Company / Corporate</strong>
                  <span style="font-size: 0.8rem; color: var(--slate); line-height: 1.35; display: block;">Business travel, corporate events, tax invoices</span>
                </div>
              </div>
            </div>

            <!-- Conditional Corporate Details Block -->
            ${sh.hireType === 'company' ? `
              <div style="margin-top: 16px; padding: 16px; background: var(--page); border-radius: 14px; border: 1px solid var(--border); display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; animation: fadeIn 0.2s ease both;">
                <div class="field" style="margin: 0;">
                  <label for="hire-company-name" style="font-weight: 750; font-size: 0.82rem; color: var(--charcoal); margin-bottom: 4px; display: block;">Company Name</label>
                  <input id="hire-company-name" type="text" data-hire-field="companyName" value="${escapeHtml(sh.companyName)}" placeholder="e.g. Acme Tours Ltd" style="padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border-strong); width: 100%; font-weight: 600;">
                </div>
                <div class="field" style="margin: 0;">
                  <label for="hire-company-tax" style="font-weight: 750; font-size: 0.82rem; color: var(--charcoal); margin-bottom: 4px; display: block;">Corporate Tax ID / TIN (Optional)</label>
                  <input id="hire-company-tax" type="text" data-hire-field="companyTaxId" value="${escapeHtml(sh.companyTaxId)}" placeholder="e.g. URA-9824-A" style="padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border-strong); width: 100%; font-weight: 600;">
                </div>
              </div>
            ` : ''}
          </div>

          <hr style="border: 0; border-top: 1px solid var(--border); margin: 0;" />

          <!-- 3. Driver Profile Selection (Rich Interactive Cards) -->
          <div>
            <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 800; color: var(--brand-red); letter-spacing: 0.05em; display: block; margin-bottom: 4px;">Staffing</span>
            <h2 style="font-size: 1.15rem; font-weight: 800; margin: 0 0 14px 0; color: var(--brand-blue-dark);">Driver Profile Preference</h2>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px;">
              <!-- Option A: Standard Driver -->
              <div class="choice-tile ${sh.driverType === 'standard' ? 'is-selected' : ''}" data-action="select-hire-driver" data-value="standard" style="padding: 16px; border-radius: 16px; border: 2px solid ${sh.driverType === 'standard' ? 'var(--brand-blue)' : 'var(--border)'}; background: ${sh.driverType === 'standard' ? 'rgba(26, 26, 26,0.03)' : 'white'}; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 10px; justify-content: space-between;">
                <div style="display: flex; align-items: flex-start; gap: 12px;">
                  <div style="width: 42px; height: 42px; border-radius: 12px; background: ${sh.driverType === 'standard' ? 'var(--brand-blue)' : 'var(--surface-alt)'}; color: ${sh.driverType === 'standard' ? 'white' : 'var(--slate)'}; display: grid; place-items: center; flex-shrink: 0;">
                    <i data-lucide="user-check" style="width: 20px; height: 20px;"></i>
                  </div>
                  <div>
                    <strong style="font-size: 0.98rem; color: var(--brand-blue-dark); display: block; margin-bottom: 2px;">Standard Route Driver</strong>
                    <span style="font-size: 0.8rem; color: var(--slate); line-height: 1.35; display: block;">Licensed, experienced corridor driver</span>
                  </div>
                </div>
                <span style="background: var(--green-soft); color: var(--green); font-size: 0.74rem; font-weight: 800; padding: 4px 10px; border-radius: 8px; align-self: flex-start;">Included</span>
              </div>

              <!-- Option B: Tour Guide Driver -->
              <div class="choice-tile ${sh.driverType === 'tour' ? 'is-selected' : ''}" data-action="select-hire-driver" data-value="tour" style="padding: 16px; border-radius: 16px; border: 2px solid ${sh.driverType === 'tour' ? 'var(--brand-blue)' : 'var(--border)'}; background: ${sh.driverType === 'tour' ? 'rgba(26, 26, 26,0.03)' : 'white'}; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 10px; justify-content: space-between;">
                <div style="display: flex; align-items: flex-start; gap: 12px;">
                  <div style="width: 42px; height: 42px; border-radius: 12px; background: ${sh.driverType === 'tour' ? 'var(--brand-blue)' : 'var(--surface-alt)'}; color: ${sh.driverType === 'tour' ? 'white' : 'var(--slate)'}; display: grid; place-items: center; flex-shrink: 0;">
                    <i data-lucide="compass" style="width: 20px; height: 20px;"></i>
                  </div>
                  <div>
                    <strong style="font-size: 0.98rem; color: var(--brand-blue-dark); display: block; margin-bottom: 2px;">Certified Tour Guide Driver</strong>
                    <span style="font-size: 0.8rem; color: var(--slate); line-height: 1.35; display: block;">Fluent in English/local languages with extensive regional tourist guiding expertise</span>
                  </div>
                </div>
                <span style="background: var(--gold-soft); color: #8a6f00; font-size: 0.74rem; font-weight: 800; padding: 4px 10px; border-radius: 8px; align-self: flex-start;">+UGX 30,000 / day</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Live Estimate Breakdown Card -->
        <div style="background: var(--surface-alt); border: 1px solid var(--border-strong); padding: 18px; border-radius: 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
          <div>
            <span style="font-size: 0.74rem; text-transform: uppercase; font-weight: 750; color: var(--muted); letter-spacing: 0.05em; display: block;">Charter Total Estimate (incl. VAT &amp; Fuel)</span>
            <div style="font-size: 1.45rem; font-weight: 850; color: var(--brand-blue-dark); margin-top: 2px;">${formatUGX(priceDetails.total)}</div>
            <span style="font-size: 0.78rem; color: var(--slate); font-weight: 500;">Includes vehicle, fuel logistics, driver allowance &amp; 18% VAT for <strong>${days} day(s)</strong></span>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="button button--ghost" type="button" data-action="special-hire-back" style="padding-inline: 18px; font-weight: 700;">Back</button>
            <button class="button button--primary" type="button" data-action="special-hire-next" style="padding-inline: 24px; font-weight: 800;">Continue to Payment →</button>
          </div>
        </div>
      </div>
    `;
  }
  
  if (step === 3) {
    const priceDetails = calculateSpecialHirePrice();
    const isCustom = sh.destinationType === 'custom';
    const isOpen = !!state.orderSummaryOpen;
    
    let destLabel = 'Entebbe – Kampala (Via Kajansi)';
    if (isCustom) {
      destLabel = sh.customDestination || 'Custom Destination';
    } else {
      const standardOption = appData.routeCards.find(r => r.key === sh.standardRoute);
      if (standardOption) {
        destLabel = `Entebbe – ${standardOption.cityB}`;
      }
    }

    const summaryListHtml = `
      <div class="detail-list">
        <div class="detail-row"><span>Vehicle Type</span><strong>${vehicleLabels[sh.vehicleType] || 'Special Vehicle'}</strong></div>
        <div class="detail-row"><span>Destination</span><strong>${escapeHtml(destLabel)}</strong></div>
        <div class="detail-row"><span>Duration</span><strong>${sh.durationDays} day${sh.durationDays > 1 ? 's' : ''} (${sh.date})</strong></div>
        <div class="detail-row"><span>Driver Preference</span><strong>${sh.driverType === 'standard' ? 'Standard Route Driver' : 'Certified Tour Guide'}</strong></div>
        ${sh.hireType === 'company' ? `<div class="detail-row"><span>Corporate Client</span><strong>${escapeHtml(sh.companyName)} ${sh.companyTaxId ? `(${escapeHtml(sh.companyTaxId)})` : ''}</strong></div>` : ''}
        <div class="detail-row"><span>Base Vehicle Hire</span><strong>${formatUGX(priceDetails.basePrice)}</strong></div>
        <div class="detail-row"><span>Driver Allowance</span><strong>${formatUGX(priceDetails.driverAllowance)}</strong></div>
        <div class="detail-row"><span>Fuel &amp; Logistics</span><strong>${formatUGX(priceDetails.fuelFee)}</strong></div>
        <div class="detail-row"><span>VAT (18%)</span><strong>${formatUGX(priceDetails.tax)}</strong></div>
      </div>
    `;
    
    return `
      ${screenHead('Private Charter & Special Hire', 'Review your charter summary and authorize payment.')}
      
      <div class="checkout-unified-layout" style="margin-top: 16px;">
        
        <!-- Mobile-only Shopify Order Summary Accordion -->
        <div class="shopify-summary-card mobile-summary-accordion ${isOpen ? 'is-open' : ''}">
          <div class="shopify-summary-header" data-action="toggle-order-summary" role="button" tabindex="0">
            <div class="shopify-summary-title">
              <i data-lucide="shopping-bag" style="width: 18px; height: 18px; color: var(--brand-blue-dark);"></i>
              <span>${isOpen ? 'Hide order summary' : 'Show order summary'}</span>
              <i data-lucide="chevron-down" class="shopify-accordion-arrow"></i>
            </div>
            <div class="shopify-summary-price">
              ${formatUGX(priceDetails.total)}
            </div>
          </div>
          ${isOpen ? `
            <div class="shopify-summary-body">
              ${summaryListHtml}
              <div class="total-row" style="border-top: 2px solid var(--border); padding-top: 12px; margin-top: 4px; display: flex; justify-content: space-between; font-size: 1.1rem; font-weight: 850;">
                <span>Total Charter Price</span>
                <strong>${formatUGX(priceDetails.total)}</strong>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="checkout-grid-container">
          <!-- Main Form Column -->
          <div class="checkout-main-col">
            <article class="card" style="margin: 0; padding: 20px;">
              <div class="card-head" style="margin-bottom: 16px;">
                <div>
                  <p class="section-kicker">Payment Method</p>
                  <h2 style="font-size: 1.15rem; font-weight: 850; color: var(--brand-blue-dark); margin: 0;">Authorize Special Hire</h2>
                </div>
              </div>
              
              ${renderStandardPaymentOptions(sh.paymentMethod, 'hire-payment-method', 'Pay the dispatcher or driver before departure')}
              
              <div style="margin-top: 16px;">
                ${renderSpecialHirePaymentPanel(priceDetails)}
              </div>
            </article>
            </article>
            
            <div style="display: flex; gap: 12px; margin-top: 16px;">
              <button class="button button--ghost" type="button" data-action="special-hire-back" style="flex: 0 0 80px;">Back</button>
              <button class="button button--golden-orange checkout-pay-btn" type="button" data-action="confirm-hire-payment" style="flex: 1;">
                <i data-lucide="shield-check" style="width: 20px; height: 20px;"></i>
                <span>Complete Special Hire — ${formatUGX(priceDetails.total)}</span>
              </button>
            </div>
          </div>

          <!-- Desktop Right Sidebar -->
          <aside class="checkout-sidebar-col">
            <div class="card checkout-summary-card">
              <div class="card-head" style="margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <i data-lucide="shopping-bag" style="width: 18px; height: 18px; color: var(--brand-blue-dark);"></i>
                  <h2 style="font-size: 1.1rem; font-weight: 850; color: var(--brand-blue-dark); margin: 0;">Charter summary</h2>
                </div>
              </div>
              ${summaryListHtml}
              <div class="total-row" style="border-top: 2px solid var(--border); padding-top: 12px; margin-top: 12px; display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 850;">
                <span>Total Price</span>
                <strong>${formatUGX(priceDetails.total)}</strong>
              </div>
            </div>
          </aside>
        </div>

      </div>
    `;
  }
  
  if (step === 4) {
    const isCustom = sh.destinationType === 'custom';
    let destLabel = 'Entebbe – Kampala (Via Kajansi)';
    if (isCustom) {
      destLabel = sh.customDestination || 'Custom Destination';
    } else {
      const standardOption = appData.routeCards.find(r => r.key === sh.standardRoute);
      if (standardOption) {
        destLabel = `Entebbe – ${standardOption.cityB}`;
      }
    }
    const priceDetails = calculateSpecialHirePrice();
    
    return `
      ${screenHead('Special Hire Confirmed', 'Use this permit to present to your private driver at departure.')}
      
      <article class="digital-ticket" style="max-width: 780px; margin: 16px auto 0;">
        <header class="ticket-header">
          <div class="ticket-brand">
            <div class="logo-frame logo-frame--ticket"><img src="assets/peebee-logo.svg" alt="Taxibee logo"></div>
            <div><h2 style="margin: 0; color: white;">Taxibee Private</h2><p style="margin: 0; color: rgba(255,255,255,.75);">Special Hire Transit Permit</p></div>
          </div>
        </header>
        
        <div class="ticket-body">
          <div class="ticket-grid">
            ${ticketField('Permit number','#SH-98402-UG')}
            ${ticketField('Vehicle type',vehicleLabels[sh.vehicleType] || 'Special Vehicle')}
            ${ticketField('Client / Contact',escapeHtml(sh.hireType === 'company' ? sh.companyName : appData.passenger.name))}
            ${ticketField('Date & duration',`${sh.date} (${sh.durationDays} Day${sh.durationDays > 1 ? 's' : ''})`)}
            ${ticketField('Private route',escapeHtml(destLabel))}
            ${ticketField('Driver preference',sh.driverType === 'standard' ? 'Standard Route Driver' : 'Certified Tour Guide')}
            ${ticketField('Total amount paid',formatUGX(priceDetails.total))}
            ${ticketField('Payment method',paymentLabel(sh.paymentMethod))}
          </div>
          
          <div class="ticket-code-area">
            <div id="hire-qr" class="ticket-qr-real" aria-label="Special Hire Permit QR code"><div class="qr-code">${generateQr()}</div></div>
            <div>
              <p class="section-kicker">Driver verification PIN</p>
              <div class="verification-code">984 021</div>
              <p class="muted text-small">Present this QR code or 6-digit verification PIN to your designated driver at pickup.</p>
            </div>
          </div>

          <div class="notice" style="margin-top: 18px;">
            <i data-lucide="shield-check"></i>
            <div>
              <strong>Charter Verification</strong>
              <div>This official digital transit permit confirms vehicle reservation, insurance coverage, and driver dispatch.</div>
            </div>
          </div>
        </div>
        <div class="ticket-perforation"></div>
        <footer class="ticket-actions">
          <button class="button button--primary button--small" type="button" data-action="print-permit"><i data-lucide="printer"></i>Print Permit</button>
          <button class="button button--ghost button--small" type="button" data-action="share-demo"><i data-lucide="share-2"></i>Share Permit</button>
          <button class="button button--ghost button--small" type="button" data-screen="support"><i data-lucide="headphones"></i>Support Desk</button>
          <button class="button button--ghost button--small" type="button" data-screen="home">Return Home</button>
        </footer>
      </article>
    `;
  }
}

let parcelMap = null;

function initParcelMap() {
  const target = $('#parcel-live-map');
  if (!target) return;
  if (!window.L) return;
  
  if (parcelMap) {
    parcelMap.remove();
    parcelMap = null;
  }

  let routeKey = 'entebbe';
  const origin = (state.parcel.origin || '').toLowerCase();
  const destination = (state.parcel.destination || '').toLowerCase();
  const rc = appData.routeCards.find(r => 
    (origin.includes(r.cityA.toLowerCase()) && destination.includes(r.cityB.toLowerCase())) ||
    (origin.includes(r.cityB.toLowerCase()) && destination.includes(r.cityA.toLowerCase()))
  );
  if (rc) routeKey = rc.key;

  const isReverse = origin.includes('kampala') || origin.includes('bweyogere') || origin.includes('busega') || origin.includes('nambole') || origin.includes('masaka') || origin.includes('lyantonde') || origin.includes('mbarara');
  const points = getCurrentRoutePoints(routeKey, isReverse);

  parcelMap = L.map(target, { 
    attributionControl: false, 
    boxZoom: false, 
    doubleClickZoom: false, 
    dragging: true, 
    keyboard: false, 
    scrollWheelZoom: true, 
    touchZoom: true, 
    zoomControl: false 
  });
  
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    maxZoom: 19, 
    crossOrigin: false 
  }).addTo(parcelMap);

  // Black route line
  L.polyline(points, { color: '#000000', opacity: 1.0, weight: 3.5 }).addTo(parcelMap);
  L.polyline(points, { color: '#c9a227', dashArray: '8 9', lineCap: 'round', opacity: 1, weight: 3 }).addTo(parcelMap);

  // Start circle marker
  L.circleMarker(points[0], { color: 'rgba(251, 192, 45, 0.4)', fillColor: 'rgba(251, 192, 45, 0.4)', fillOpacity: 1, radius: 18, weight: 0 }).addTo(parcelMap);
  L.circleMarker(points[0], { color: '#ffffff', fillColor: '#ffffff', fillOpacity: 1, radius: 8, weight: 0 }).addTo(parcelMap);
  L.circleMarker(points[0], { color: '#000000', fillColor: '#000000', fillOpacity: 1, radius: 4, weight: 0 }).addTo(parcelMap);

  // End pin marker
  const pinIcon = L.divIcon({
    className: 'custom-pin-marker',
    html: `
      <div class="end-marker-container">
        <div class="end-marker-outer"></div>
        <div class="end-marker-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="black" stroke="black" stroke-width="2"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.74a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
  L.marker(points[points.length - 1], { icon: pinIcon }).addTo(parcelMap);

  const bounds = L.latLngBounds(points);
  parcelMap.fitBounds(bounds, { padding: [50, 50] });

  setTimeout(() => {
    if (parcelMap) {
      parcelMap.invalidateSize();
      parcelMap.fitBounds(bounds, { padding: [50, 50] });
    }
  }, 200);
}

function renderParcelList() {
  return `
    ${screenHead('Track Parcel', 'View and track your active and past parcels.', '<button class="button button--primary" type="button" data-screen="parcel"><i data-lucide="plus"></i>Send a Parcel</button>')}
    
    <div class="field" style="margin-bottom: 20px;">
      <div class="input-group">
        <span class="input-icon"><i data-lucide="search"></i></span>
        <input class="search-input search-input--icon" type="text" placeholder="Search by tracking number or recipient…" data-action="search-parcels">
      </div>
    </div>

    <section class="grid" style="gap: 14px;">
      <article class="card card--hover parcel-list-card" data-screen="trackparcel" role="button" tabindex="0">
        <div class="card-head">
          <div>
            <p class="section-kicker">Tracking #964201832-DL</p>
            <h3 style="margin: 4px 0 0;">Package from Entebbe</h3>
          </div>
          <span class="status-chip status-chip--gold">On the way</span>
        </div>
        <div class="parcel-list-card__details">
          <div class="route-label" style="margin: 12px 0 0;">
            <div class="route-points"><span></span><i></i><span></span></div>
            <div><strong>Entebbe</strong><p class="muted text-small" style="margin: 2px 0;">Estimated arrival: Today, 2:30 PM</p><strong>Kampala</strong></div>
          </div>
          <div class="parcel-list-card__meta">
            <span><i data-lucide="package"></i>Small box · 520 g</span>
            <span><i data-lucide="user-round"></i>To: Joan Nankya</span>
          </div>
        </div>
        <div class="parcel-list-card__footer" onclick="event.stopPropagation();">
          <span class="parcel-list-card__driver" role="button" tabindex="0" onclick="event.stopPropagation(); showDriverProfileModal('isaac muwonge');" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" title="View Driver Profile"><img src="assets/driver_1-branded.png" alt="Isaac Muwonge" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">Isaac Muwonge · UBM 245K</span>
          <span class="muted text-small">Updated 3 min ago</span>
        </div>
      </article>

      <article class="card parcel-list-card parcel-list-card--delivered">
        <div class="card-head">
          <div>
            <p class="section-kicker">Tracking #964201710-DL</p>
            <h3 style="margin: 4px 0 0;">Documents to Kampala Office</h3>
          </div>
          <span class="status-chip status-chip--success">Delivered</span>
        </div>
        <div class="parcel-list-card__details">
          <div class="route-label" style="margin: 12px 0 0;">
            <div class="route-points"><span></span><i></i><span></span></div>
            <div><strong>Entebbe</strong><p class="muted text-small" style="margin: 2px 0;">Delivered: 16 Jul, 11:42 AM</p><strong>Kampala</strong></div>
          </div>
          <div class="parcel-list-card__meta">
            <span><i data-lucide="package"></i>Documents · 280 g</span>
            <span><i data-lucide="user-round"></i>To: Mark Ochieng</span>
          </div>
        </div>
        <div class="parcel-list-card__footer">
          <span class="muted text-small">Collected by recipient</span>
          <span class="muted text-small">16 Jul 2026</span>
        </div>
      </article>

      <article class="card parcel-list-card parcel-list-card--delivered">
        <div class="card-head">
          <div>
            <p class="section-kicker">Tracking #964200988-DL</p>
            <h3 style="margin: 4px 0 0;">Gift parcel</h3>
          </div>
          <span class="status-chip status-chip--success">Delivered</span>
        </div>
        <div class="parcel-list-card__details">
          <div class="route-label" style="margin: 12px 0 0;">
            <div class="route-points"><span></span><i></i><span></span></div>
            <div><strong>Kampala</strong><p class="muted text-small" style="margin: 2px 0;">Delivered: 10 Jul, 4:15 PM</p><strong>Entebbe</strong></div>
          </div>
          <div class="parcel-list-card__meta">
            <span><i data-lucide="package"></i>Medium box · 1.2 kg</span>
            <span><i data-lucide="user-round"></i>To: Grace Nambi</span>
          </div>
        </div>
        <div class="parcel-list-card__footer">
          <span class="muted text-small">Collected by another person</span>
          <span class="muted text-small">10 Jul 2026</span>
        </div>
      </article>
    </section>
  `;
}

function renderParcelTracking() {
  document.body.setAttribute('data-active-screen', 'trackparcel');
  setTimeout(initParcelMap, 50);

  return `
    <div class="parcel-live-container">
      <div id="parcel-live-map" class="parcel-live-map"></div>
      
      <div class="parcel-live-card" role="button" tabindex="0" data-screen="parcel-status">
        <div class="parcel-live-card__header">
          <div>
            <span class="parcel-live-card__label">Delivery ID</span>
            <strong class="parcel-live-card__id">#964201832-DL</strong>
          </div>
          <span class="status-chip status-chip--gold">On the way</span>
        </div>
        
        <div class="parcel-live-card__grid">
          <div class="parcel-live-card__grid-item">
            <span class="parcel-live-card__grid-label">Tariff</span>
            <strong class="parcel-live-card__grid-val">Small box</strong>
          </div>
          <div class="parcel-live-card__grid-item">
            <span class="parcel-live-card__grid-label">Weight</span>
            <strong class="parcel-live-card__grid-val">520 g</strong>
          </div>
          <div class="parcel-live-card__grid-item">
            <span class="parcel-live-card__grid-label">To</span>
            <strong class="parcel-live-card__grid-val">Joan Nankya</strong>
          </div>
        </div>
        
        <hr class="parcel-live-card__divider">
        
        <div class="parcel-live-card__driver" role="button" tabindex="0" onclick="event.stopPropagation(); showDriverProfileModal('isaac muwonge');" style="cursor: pointer;">
          <div class="parcel-live-card__driver-left">
            <img src="assets/driver_1-branded.png" alt="Isaac Muwonge" class="parcel-live-card__avatar">
            <div class="parcel-live-card__driver-info">
              <strong>Isaac Muwonge</strong>
              <span>Driver</span>
            </div>
          </div>
          <div class="parcel-live-card__actions" onclick="event.stopPropagation();">
            <button class="circle-btn" type="button" data-action="chat-driver" aria-label="Chat with driver"><i data-lucide="message-square"></i></button>
            <button class="circle-btn" type="button" data-action="call-driver" aria-label="Call driver"><i data-lucide="phone"></i></button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderParcelStatus() {
  document.body.setAttribute('data-active-screen', 'parcel-status');

  return `
    <div class="parcel-status-container">
      <div class="parcel-status-card">
        <div class="parcel-status-card__header">
          <h2>Package from Entebbe</h2>
          <button class="icon-button" type="button" aria-label="Edit title" data-action="edit-parcel-title"><i data-lucide="pencil"></i></button>
        </div>
        <span class="status-chip status-chip--gold">On the way</span>
        
        <div class="parcel-timeline">
          <div class="parcel-timeline-item is-complete">
            <div class="parcel-timeline-dot"></div>
            <div class="parcel-timeline-content">
              <strong>Order confirmed</strong>
              <span>Feb 21, 2025 &bull; Entebbe</span>
            </div>
          </div>
          <div class="parcel-timeline-item is-complete">
            <div class="parcel-timeline-dot"></div>
            <div class="parcel-timeline-content">
              <strong>Preparing for shipment</strong>
              <span>Feb 21, 2025, 16:05 &bull; Entebbe</span>
            </div>
          </div>
          <div class="parcel-timeline-item is-complete">
            <div class="parcel-timeline-dot"></div>
            <div class="parcel-timeline-content">
              <strong>Arrived to sorting facility</strong>
              <span>Feb 22, 2025 &bull; Kampala sorting facility</span>
            </div>
          </div>
          <div class="parcel-timeline-item is-active">
            <div class="parcel-timeline-dot"></div>
            <div class="parcel-timeline-content">
              <strong>Transferred for delivery</strong>
              <span>3–5 days</span>
            </div>
          </div>
          <div class="parcel-timeline-item is-pending">
            <div class="parcel-timeline-dot"></div>
            <div class="parcel-timeline-content">
              <strong>Expected delivery on March 4</strong>
            </div>
          </div>
        </div>
        
        <div class="parcel-details-box">
          <div class="parcel-details-row">
            <span>Tariff</span>
            <strong>Small box</strong>
          </div>
          <div class="parcel-details-row">
            <span>Weight</span>
            <strong>520 g</strong>
          </div>
          <div class="parcel-details-row">
            <span>Recipient</span>
            <strong>Joan Nankya</strong>
          </div>
        </div>
        
        <button class="button button--receivers w-full" type="button" data-action="receiving-another">
          <span>Receiving by another person</span>
          <i data-lucide="chevron-right"></i>
        </button>
      </div>
    </div>
  `;
}

function renderDriverProfile() {
  document.body.setAttribute('data-active-screen', 'driver-profile');
  
  const driverNameKey = state.viewingDriverName || 'isaac muwonge';
  const driver = driversData[driverNameKey] || driversData['isaac muwonge'];
  
  const isDriving = driver.status === 'driving';
  const avatarUrl = driver.avatar || 'assets/driver_1-branded.png';

  return `
    <div class="driver-profile-container">
      <div class="driver-profile-left-col">
        <div class="driver-profile-header-card">
          <div style="position: relative;">
            <img src="${avatarUrl}" alt="${driver.name}" class="driver-profile-avatar">
            ${isDriving ? `<span class="status-chip status-chip--gold" style="position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; box-shadow: var(--shadow-sm); z-index: 2;">On Road</span>` : ''}
          </div>
          <h2>${driver.name}</h2>
          <span class="driver-role-badge">${driver.role}</span>
          <div class="driver-rating-row">
            <i data-lucide="star" class="star-icon"></i>
            <strong>${driver.rating}</strong>
            <span class="muted">(${driver.routes} routes)</span>
          </div>
        </div>

        <div class="driver-contact-actions">
          <button class="button button--secondary" type="button" data-action="chat-driver" ${isDriving ? 'style="opacity: 0.6; cursor: not-allowed;"' : ''}>
            <i data-lucide="${isDriving ? 'message-square-off' : 'message-square'}"></i> ${isDriving ? 'Chat (Unavailable)' : `Chat with ${driver.name.split(' ')[0]}`}
          </button>
          <button class="button button--primary" type="button" data-action="call-driver">
            <i data-lucide="phone"></i> Call ${driver.name.split(' ')[0]}
          </button>
        </div>
      </div>
      
      <div class="driver-profile-right-col">
        <div class="driver-stats-grid">
          <div class="driver-stat-card">
            <span class="driver-stat-val">${driver.km} km</span>
            <span class="driver-stat-label">On Road</span>
          </div>
          <div class="driver-stat-card">
            <span class="driver-stat-val">${driver.associationTime}</span>
            <span class="driver-stat-label">With Association</span>
          </div>
          <div class="driver-stat-card">
            <span class="driver-stat-val">Uganda</span>
            <span class="driver-stat-label">Country</span>
          </div>
        </div>

        <div class="driver-info-section">
          <h3>About ${driver.name.split(' ')[0]}</h3>
          <p>${driver.bio}</p>
        </div>

        <div class="driver-info-section">
          <h3>Vehicle Information</h3>
          <div class="vehicle-details-card">
            <div class="vehicle-icon-frame">
              <i data-lucide="truck"></i>
            </div>
            <div class="vehicle-info-text">
              <strong>${driver.vehicle}</strong>
              <span>Plate: ${driver.plate} &bull; ${driver.color}</span>
            </div>
          </div>
        </div>

        <div class="driver-info-section">
          <h3>Compliments</h3>
          <div class="compliment-badges">
            ${driver.compliments.map(comp => `
              <span class="compliment-badge">
                <i data-lucide="${comp.includes('Safe') || comp.includes('Gentle') ? 'shield-check' : comp.includes('Punctual') ? 'clock' : comp.includes('Navigator') ? 'navigation' : 'smile'}"></i>
                ${comp}
              </span>
            `).join('')}
          </div>
        </div>

        <div class="driver-info-section">
          <h3>Traveler Reviews</h3>
          <div class="driver-reviews-list" style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
            ${driver.reviews && driver.reviews.length ? driver.reviews.map(rev => `
              <div class="driver-review-card" style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; text-align: left;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--brand-blue-soft); color: var(--brand-blue); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.75rem;">
                      ${rev.author.split(' ').map(n=>n[0]).join('')}
                    </div>
                    <div>
                      <strong style="font-size: 0.82rem; color: var(--charcoal); display: block; line-height: 1.2;">${rev.author}</strong>
                      <span class="muted" style="font-size: 0.7rem;">${rev.date}</span>
                    </div>
                  </div>
                  <div style="color: var(--brand-gold); font-size: 0.8rem;">
                    ${'★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating)}
                  </div>
                </div>
                <p style="margin: 0; font-size: 0.8rem; line-height: 1.4; color: var(--slate);">${rev.comment}</p>
              </div>
            `).join('') : '<p class="muted" style="font-size: 0.8rem; margin: 0;">No reviews yet.</p>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function showDriverProfileModal(driverNameKey) {
  const driverNameClean = (driverNameKey || 'isaac muwonge').toLowerCase().trim();
  const driver = driversData[driverNameClean] || driversData['isaac muwonge'];
  const avatarUrl = driver.avatar || 'assets/driver_1-branded.png';
  const vehicleHeroImg = getTripVehicleImage(driver.vehicle);

  const bodyHtml = `
    <div class="driver-modal-content" style="text-align: left; padding: 4px;">
      <!-- Top Centered Profile Avatar Block (Reduced by 30%) -->
      <div class="driver-modal-avatar-wrapper">
        <div class="driver-modal-avatar-container">
          <img src="${avatarUrl}" alt="${driver.name}" class="driver-modal-avatar-img" />
          <!-- Rating badge placed at bottom of profile image -->
          <div class="driver-modal-rating-badge" style="position: absolute; bottom: -12px; left: 50%; transform: translateX(-50%); background: white; border: 1px solid var(--border-subtle); padding: 4px 14px; border-radius: 20px; box-shadow: 0 4px 14px rgba(26,26,26,0.14); display: flex; align-items: center; gap: 5px; font-size: 0.82rem; font-weight: 850; color: var(--brand-blue-dark); white-space: nowrap; z-index: 5;">
            <i data-lucide="star" style="width: 14px; height: 14px; fill: var(--brand-gold); color: var(--brand-gold);"></i>
            <span>${driver.rating}</span>
            <span style="color: var(--slate); font-weight: 600; font-size: 0.75rem;">(${driver.routes} routes)</span>
          </div>
        </div>
        <!-- Stacked Name & Job Title -->
        <h2 style="margin: 16px 0 6px 0; font-size: 1.45rem; font-weight: 850; color: var(--brand-blue-dark); text-align: center;">${driver.name}</h2>
        <div style="text-align: center; margin-bottom: 4px;">
          <span class="driver-role-badge" style="display: inline-block; background: #faf8ef; color: var(--brand-blue); font-size: 0.78rem; font-weight: 800; padding: 4px 14px; border-radius: 12px;">${driver.role}</span>
        </div>
      </div>

      <!-- Stats Bar (3 Columns) -->
      <div style="background: var(--surface-alt); border-radius: 16px; padding: 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 20px; text-align: center; border: 1px solid var(--border-subtle);">
        <div>
          <strong style="display: block; font-size: 0.95rem; font-weight: 850; color: var(--brand-blue-dark);">${driver.km} km</strong>
          <span style="font-size: 0.7rem; color: var(--slate); font-weight: 600;">On Road</span>
        </div>
        <div>
          <strong style="display: block; font-size: 0.95rem; font-weight: 850; color: var(--brand-blue-dark);">${driver.associationTime}</strong>
          <span style="font-size: 0.7rem; color: var(--slate); font-weight: 600;">With Association</span>
        </div>
        <div>
          <strong style="display: block; font-size: 0.95rem; font-weight: 850; color: var(--brand-blue-dark);">Uganda</strong>
          <span style="font-size: 0.7rem; color: var(--slate); font-weight: 600;">Country</span>
        </div>
      </div>

      <!-- About Section -->
      <div style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 6px 0; font-size: 0.78rem; font-weight: 800; color: var(--slate); text-transform: uppercase; letter-spacing: 0.06em;">About</h4>
        <p style="margin: 0; font-size: 0.88rem; line-height: 1.5; color: var(--charcoal); font-weight: 500;">${driver.bio}</p>
      </div>

      <!-- Vehicle Information Section (with Van Photo) -->
      <div style="margin-bottom: 20px;">
        <h4 style="margin: 0 0 8px 0; font-size: 0.78rem; font-weight: 800; color: var(--slate); text-transform: uppercase; letter-spacing: 0.06em;">Vehicle Information</h4>
        <div style="display: flex; align-items: center; gap: 14px; background: var(--surface-alt); border: 1px solid var(--border-subtle); padding: 12px; border-radius: 18px;">
          <div style="width: 120px; height: 80px; border-radius: 12px; overflow: hidden; background: #faf8ef; position: relative; flex-shrink: 0; box-shadow: 0 4px 12px rgba(26,26,26,0.08); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: center; padding: 4px;">
            <img src="${vehicleHeroImg}" alt="${driver.vehicle}" style="max-width: 100%; max-height: 100%; object-fit: contain;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: #0a0a0a; color: white;">
              <i data-lucide="bus-front" style="width: 28px; height: 28px;"></i>
            </div>
          </div>
          <div style="font-size: 0.88rem; min-width: 0;">
            <strong style="display: block; color: var(--brand-blue-dark); font-size: 1.02rem; font-weight: 850; margin-bottom: 3px;">${driver.vehicle}</strong>
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 2px;">
              <span style="display: inline-block; color: var(--brand-blue); font-weight: 800; font-size: 0.78rem; background: rgba(26,26,26,0.08); padding: 2px 8px; border-radius: 8px;">${driver.plate}</span>
              <span style="color: var(--slate); font-size: 0.78rem; font-weight: 600;">• ${driver.color}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Compliments Section -->
      <div style="margin-bottom: 12px;">
        <h4 style="margin: 0 0 8px 0; font-size: 0.78rem; font-weight: 800; color: var(--slate); text-transform: uppercase; letter-spacing: 0.06em;">Compliments</h4>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${driver.compliments.map(comp => `
            <span class="compliment-badge" style="display: inline-flex; align-items: center; gap: 6px; background: var(--surface-alt); border: 1px solid var(--border); padding: 6px 12px; border-radius: 12px; font-size: 0.78rem; font-weight: 700; color: var(--brand-blue-dark);">
              <i data-lucide="${comp.includes('Safe') || comp.includes('Gentle') ? 'shield-check' : comp.includes('Punctual') ? 'clock' : comp.includes('Navigator') ? 'navigation' : 'smile'}" style="width: 14px; height: 14px; color: var(--brand-blue);"></i>
              ${comp}
            </span>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  const footerHtml = `
    <div style="display: flex; gap: 12px; width: 100%;">
      <button class="button button--secondary" type="button" data-action="modal-chat-driver" data-value="${driverNameClean}" style="flex: 1; height: 48px; border-radius: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <i data-lucide="message-square"></i> Chat
      </button>
      <button class="button button--primary" type="button" data-action="modal-call-driver" data-value="${driverNameClean}" style="flex: 1; height: 48px; border-radius: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <i data-lucide="phone"></i> Call
      </button>
    </div>
  `;

  openModal('Driver Profile', bodyHtml, footerHtml, false, 'modal--driver-profile');
}
window.showDriverProfileModal = showDriverProfileModal;

function renderDriverChat() {
  const driverNameKey = state.viewingDriverName || 'isaac muwonge';
  const driver = driversData[driverNameKey] || driversData['isaac muwonge'];
  const avatarUrl = driver.avatar || 'assets/driver_1-branded.png';
  const firstName = driver.name.split(' ')[0];
  const initials = driver.name.split(' ').map(n => n[0]).join('');

  const demoMessages = [
    { from: 'driver', text: `Hello! I'm ${firstName}, your driver for today's trip.`, time: '8:12 AM' },
    { from: 'driver', text: 'I am currently at Entebbe Main Stage. The vehicle is boarding now.', time: '8:12 AM' },
    { from: 'passenger', text: 'Thank you! I\'m on my way. Please hold for 2 minutes.', time: '8:14 AM' },
    { from: 'driver', text: 'No problem. I will wait. Please hurry, we depart at 8:30 AM.', time: '8:14 AM' },
    { from: 'passenger', text: 'Understood, almost there!', time: '8:15 AM' },
    { from: 'driver', text: 'Great, I can see you. Welcome aboard! 👋', time: '8:16 AM' },
  ];

  return `
    <div class="driver-chat-screen">
      <div class="driver-chat-card">
        <div class="chat-driver-header">
          <button class="icon-button" type="button" data-action="back-from-chat" aria-label="Close Chat" style="color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.12); border-radius: 50%; width: 36px; height: 36px; display: grid; place-items: center; border: none; cursor: pointer; flex-shrink: 0;"><i data-lucide="arrow-left"></i></button>
          <div class="chat-driver-header__info">
            <div>
              <strong style="cursor: pointer;" onclick="showDriverProfileModal('${driverNameKey.replace(/'/g, "\\'")}')">${driver.name}</strong>
              <span class="chat-driver-status"><span class="chat-driver-status__dot"></span>Online</span>
            </div>
          </div>
          <div class="chat-driver-header__actions">
            <button class="icon-button" type="button" data-action="call-driver" aria-label="Call driver"><i data-lucide="phone"></i></button>
            <button class="icon-button" type="button" onclick="showDriverProfileModal('${driverNameKey.replace(/'/g, "\\'")}')" aria-label="View driver profile" style="padding: 0; overflow: hidden; border: 2px solid rgba(255,255,255,0.85); background: rgba(255,255,255,0.15);">
              ${avatarUrl ? `<img src="${avatarUrl}" alt="${driver.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` : initials}
            </button>
          </div>
        </div>

        <div class="chat-date-divider"><span>Today</span></div>

        <div class="chat-messages-container">
          ${driver.status === 'driving' ? `
            <div class="chat-notice" style="background: rgba(242,161,4,0.12); border: 1px solid rgba(242,161,4,0.3); color: #855300; border-radius: 12px; padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 8px; font-size: 0.8rem; font-weight: 600; line-height: 1.4;">
              <i data-lucide="info" style="width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; color: #d48806;"></i>
              <span><strong>Driver is on the road:</strong> Your message will be delivered now, but ${firstName} will read it upon reaching their destination.</span>
            </div>
          ` : `
            <div class="chat-notice">
              <i data-lucide="shield-check"></i>
              <span>Messages are only available for your active trip. Chat history is cleared after the trip ends.</span>
            </div>
          `}

          ${demoMessages.map(msg => `
            <div class="chat-bubble ${msg.from === 'passenger' ? 'chat-bubble--sent' : 'chat-bubble--received'}">
              ${msg.from === 'driver' ? `
                ${avatarUrl ? `<img src="${avatarUrl}" alt="" class="chat-bubble__avatar">` : `<div class="chat-bubble__avatar chat-bubble__avatar--initials">${initials}</div>`}
              ` : ''}
              <div class="chat-bubble__body">
                <p>${msg.text}</p>
                <span class="chat-bubble__time">${msg.time}${msg.from === 'passenger' ? ' <i data-lucide="check-check" style="width:12px;height:12px;display:inline;vertical-align:-2px;color:var(--brand-blue);"></i>' : ''}</span>
              </div>
            </div>
          `).join('')}

          <div class="chat-typing-indicator">
            <div class="chat-bubble chat-bubble--received">
              ${avatarUrl ? `<img src="${avatarUrl}" alt="" class="chat-bubble__avatar">` : `<div class="chat-bubble__avatar chat-bubble__avatar--initials">${initials}</div>`}
              <div class="chat-bubble__body chat-bubble__body--typing">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </div>
            </div>
          </div>
        </div>

        <div class="chat-compose-bar">
          <button class="chat-compose-btn" type="button" data-action="upload-demo" aria-label="Attach file"><i data-lucide="paperclip"></i></button>
          <input class="chat-compose-input" type="text" placeholder="Type a message..." value="">
          <button class="chat-compose-btn chat-compose-btn--primary" type="button" data-action="send-chat-demo" aria-label="Send message"><i data-lucide="send-horizontal"></i></button>
        </div>
      </div>
    </div>
  `;
}

function renderDriverCall() {
  const driverNameKey = state.viewingDriverName || 'isaac muwonge';
  const driver = driversData[driverNameKey] || driversData['isaac muwonge'];
  const avatarUrl = driver.avatar || 'assets/driver_1-branded.png';
  const firstName = driver.name.split(' ')[0];
  const initials = driver.name.split(' ').map(n => n[0]).join('');
  const phone = driver.plate ? `+256 7XX XXX XXX` : '+256 700 000 000';

  return `
    <div class="driver-call-screen">
      <div class="driver-call-card">
        <button class="icon-button" type="button" data-action="end-call-demo" aria-label="Close Call" style="position: absolute; top: 20px; left: 20px; z-index: 10; color: white; background: rgba(255,255,255,0.15); border: none; border-radius: 50%; width: 40px; height: 40px; display: grid; place-items: center; cursor: pointer;">
          <i data-lucide="arrow-left"></i>
        </button>

        <div class="call-background">
          <div class="call-bg-circle call-bg-circle--1"></div>
          <div class="call-bg-circle call-bg-circle--2"></div>
          <div class="call-bg-circle call-bg-circle--3"></div>
        </div>

        <div class="call-content">
          <div class="call-avatar-section">
            <div class="call-avatar-ring">
              ${avatarUrl ? `<img src="${avatarUrl}" alt="${driver.name}" class="call-avatar-img">` : `<div class="call-avatar-initials">${initials}</div>`}
            </div>
            <h2 class="call-name">${driver.name}</h2>
            <p class="call-role">${driver.role} · ${driver.plate}</p>
            <div class="call-status-indicator">
              <span class="call-pulse"></span>
              <span class="call-status-text">Calling...</span>
            </div>
            <p class="call-timer">00:00</p>
          </div>

          <div class="call-notice">
            <i data-lucide="info"></i>
            <span>This is a prototype preview. No real call is being placed.</span>
          </div>

          <div class="call-actions">
            <button class="call-action-btn" type="button" data-action="toggle-mute-demo" aria-label="Mute">
              <span class="call-action-icon"><i data-lucide="mic-off"></i></span>
              <span>Mute</span>
            </button>
            <button class="call-action-btn" type="button" data-action="toggle-speaker-demo" aria-label="Speaker">
              <span class="call-action-icon"><i data-lucide="volume-2"></i></span>
              <span>Speaker</span>
            </button>
            <button class="call-action-btn" type="button" data-action="chat-driver" aria-label="Message">
              <span class="call-action-icon"><i data-lucide="message-square"></i></span>
              <span>Message</span>
            </button>
          </div>

          <div class="call-end-section">
            <button class="call-end-btn" type="button" data-action="end-call-demo" aria-label="End call">
              <i data-lucide="phone-off"></i>
            </button>
            <span class="call-end-label">End Call</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderOffers() {
  const offers = [
    ['Return for UGX 4,000','Secure a subsidized return when booking your outbound trip.','refresh-cw','Taxibee Offer'],
    ['Wallet deposit bonus','Receive UGX 2,000 promotional credit after an eligible deposit.','wallet-cards','Taxibee Offer'],
    ['Frequent traveller rewards','Complete five trips and unlock a priority-booking reward preview.','award','Taxibee Offer'],
    ['Parcel business bundle','Send four qualifying business parcels and receive discounted handling.','package-check','Taxibee Offer'],
    ['Refer a passenger','Share Taxibee and preview a reward after their first journey.','users-round','Taxibee Offer'],
    ['Corporate commuter plan','Centralized travel for teams with monthly account reporting.','building-2','Taxibee Offer']
  ];
  return `
    ${screenHead('Offers and promotions', 'Browse Taxibee campaigns and clearly labelled third-party advertisements.')}
    <section class="grid grid--3">${offers.map(item => `<article class="card card--hover offer-card"><div><span class="status-chip status-chip--info">${item[3]}</span><div class="offer-card__icon" style="margin-top:18px"><i data-lucide="${item[2]}"></i></div><h2 style="margin:15px 0 8px">${item[0]}</h2><p class="muted">${item[1]}</p></div><button class="button button--ghost button--small" type="button" data-action="offer-details">View Conditions</button></article>`).join('')}</section>
    <div class="section-title"><h2>Sponsored partners</h2><span class="muted text-small">Paid placements are clearly identified</span></div>
    <section class="grid grid--2"><article class="card sponsored-card"><div><span class="sponsored-label">Sponsored</span><p class="section-kicker" style="margin-top:18px;color:var(--brand-gold)">Lakeview Business Centre</p><h2>Business printing and parcel-ready packaging.</h2><p style="color:rgba(255,255,255,.72)">Available near Kitooro. Demonstration advertiser content.</p></div><button class="button button--gold button--small" type="button" data-action="sponsored-details">Advertiser Details</button></article><article class="card sponsored-card" style="background:linear-gradient(135deg,#3a1d0b,#754018)"><div><span class="sponsored-label">Sponsored</span><p class="section-kicker" style="margin-top:18px;color:var(--brand-gold)">Kampala Coffee House</p><h2>Show your Taxibee ticket for a breakfast offer.</h2><p style="color:rgba(255,255,255,.72)">Fictional promotion for stakeholder demonstration.</p></div><button class="button button--gold button--small" type="button" data-action="sponsored-details">Advertiser Details</button></article></section>`;
}

function renderNotifications() {
  const categories = ['all','Travels','Payments','Parcels','Alerts'];
  const items = appData.notifications.filter(item => state.notificationFilter === 'all' || item.category === state.notificationFilter);
  return `
    ${screenHead('Notifications', 'Trip, wallet, parcel, luggage, promotion and service updates appear in one place.', '<button class="button button--ghost" type="button" data-action="mark-all-read"><i data-lucide="check-check"></i>Mark all as read</button><button class="button button--primary" type="button" data-action="notification-preferences"><i data-lucide="settings-2"></i>Preferences</button>')}
    <div class="tabs">${categories.map(category => `<button class="tab ${state.notificationFilter === category ? 'is-active' : ''}" type="button" data-action="notification-filter" data-value="${category}">${category === 'all' ? 'All' : category}</button>`).join('')}</div>
    <section class="card" style="margin-top:16px;padding:8px 12px"><div class="notification-list">${items.length ? items.map(renderNotification).join('') : emptyState('bell-off','No notifications here','New updates will appear in this category.')}</div></section>`;
}

function renderNotification(item) {
  return `<button class="notification-item ${item.unread ? 'is-unread' : ''}" type="button" data-action="notification-detail" data-id="${item.id}"><span class="notification-item__icon"><i data-lucide="${item.icon}"></i></span><span class="notification-item__copy"><strong>${item.title}</strong><span>${item.body}</span><span style="margin-top:4px">${item.category} · ${item.time}</span></span>${item.unread ? '<span class="unread-dot" aria-label="Unread"></span>' : '<i data-lucide="chevron-right"></i>'}</button>`;
}

function renderSupport() {
  return `
    ${screenHead('Help and customer support', 'Find answers, report an issue, preview chat support or submit a demonstration support request.')}
    <section class="grid grid--4">
      ${supportAction('Call Taxibee','phone-call','call-support')}${supportAction('Chat Support','messages-square','chat-support')}${supportAction('Lost Property','search','lost-item')}${supportAction('Safety Concern','shield-alert','emergency')}
    </section>
    <section class="grid grid--sidebar" style="margin-top:18px"><div class="grid"><article class="card"><div class="card-head"><div><p class="section-kicker">Support ticket</p><h2>Report a problem</h2></div><span class="status-chip status-chip--info">Demo submission</span></div>${state.supportSubmitted ? supportSuccess() : supportForm()}</article><article class="card"><div class="card-head"><div><p class="section-kicker">Frequently asked questions</p><h2>Passenger guidance</h2></div></div><div class="faq-list">${faq('How early should I arrive?','Please arrive at least 15 minutes before departure so the crew can verify your booking and luggage.')}${faq('How does an open return work?','Book an eligible Kampala-to-Entebbe departure before the return ticket expiry date.')}${faq('What happens if my vehicle changes?','Your booking reference remains valid and the app preview displays the replacement registration.')}${faq('How does parcel collection work?','The recipient presents the collection PIN and identification at the destination parcel desk.')}${faq('Can I pay cash?','The cash-at-stage option places the booking in Payment Pending status until a dispatcher confirms payment.')}</div></article></div><aside class="grid"><article class="card"><h3>Support categories</h3><div class="settings-list">${['Payment Dispute','Parcel Complaint','Luggage Complaint','Trip Complaint','Safety Concern','Suggestion'].map((label,index) => `<button class="settings-row" type="button" data-action="support-category" data-value="${label}"><span class="settings-row__icon"><i data-lucide="${['credit-card','package-x','luggage','bus-front','shield-alert','message-circle-more'][index]}"></i></span><span class="settings-row__copy"><strong>${label}</strong><span>Open the relevant request form</span></span><i data-lucide="chevron-right"></i></button>`).join('')}</div></article><article class="card card--soft"><p class="section-kicker">Demonstration contacts</p><h3>Taxibee Support Desk</h3><p class="muted">+256 700 000 000<br>support@example.taxibee.demo</p><p class="privacy-note">Placeholder contact information for presentation only.</p></article></aside></section>`;
}

function supportAction(label, icon, action) { return `<button class="card card--hover" style="text-align:left;cursor:pointer" type="button" data-action="${action}"><span class="quick-action__icon"><i data-lucide="${icon}"></i></span><strong style="display:block;margin-top:10px">${label}</strong><span class="muted text-small">Open preview</span></button>`; }
function faq(question, answer) { return `<div class="faq-item"><button class="faq-question" type="button" data-action="faq-toggle"><span>${question}</span><i data-lucide="chevron-down"></i></button><div class="faq-answer">${answer}</div></div>`; }
function supportForm() {
  return `<div class="form-grid"><div class="field"><label>Category</label><select id="support-category"><option>Trip Complaint</option><option>Payment Dispute</option><option>Lost Property</option><option>Parcel Complaint</option><option>Luggage Complaint</option><option>Safety Concern</option><option>Suggestion</option></select></div><div class="field"><label>Priority</label><select><option>Normal</option><option>Urgent</option><option>Safety critical</option></select></div><div class="field"><label>Related booking</label><select><option>FX-260718-1842</option><option>None</option></select></div><div class="field"><label>Related parcel</label><select><option>None</option><option>FXP-260718-0842</option></select></div><div class="field field--full"><label>Subject</label><input value="Question about my boarding time"></div><div class="field field--full"><label>Description</label><textarea>Please confirm whether I should arrive 15 minutes before the departure time.</textarea></div><div class="field field--full"><label>Attachment</label><div class="upload-box" data-action="upload-demo"><div><i data-lucide="paperclip"></i><strong style="display:block">Attach image or document</strong><span>Visual placeholder only</span></div></div></div></div><div class="button-row button-row--end" style="margin-top:16px"><button class="button button--primary" type="button" data-action="submit-support">Submit Support Request</button></div>`;
}
function supportSuccess() {
  return `<div class="payment-state"><div class="payment-state__icon payment-state__icon--success"><i data-lucide="circle-check-big"></i></div><h2>Support request submitted</h2><p class="muted">Your demonstration request has been assigned reference SUP-44720.</p><div class="detail-list" style="text-align:left"><div class="detail-row"><span>Status</span><strong>Submitted</strong></div><div class="detail-row"><span>Assigned status</span><strong>Under Review</strong></div><div class="detail-row"><span>Expected response</span><strong>Within 2 hours</strong></div></div><div class="button-row" style="justify-content:center;margin-top:16px"><button class="button button--primary" type="button" data-action="support-statuses">View Support Request</button><button class="button button--ghost" type="button" data-action="new-support">New Request</button></div></div>`;
}

function renderProfile() {
  const avatar = state.userAvatar || 'assets/christo-avatar.jpg';
  const name = state.userName || 'Christo I.';
  const phone = state.userPhone || '+256 772 345 678';
  const email = state.userEmail || 'christo.i@example.com';
  const emergency = state.emergencyContact || '+256 700 123 456';

  return `
    ${screenHead('Profile and settings', 'Manage passenger details, language, accessibility, privacy and demonstration preferences.')}
    <section class="grid grid--sidebar">
      <div class="grid">
        <!-- Modernized Profile Preview Card -->
        <article class="card profile-preview-card" style="position: relative; overflow: hidden; background: linear-gradient(135deg, rgba(26,26,26, 0.05) 0%, rgba(26, 26, 26, 0.02) 100%), #ffffff; border: 1px solid var(--border-strong); border-radius: 24px; padding: 22px; box-shadow: 0 4px 20px rgba(26,26,26, 0.06);">
          <div class="profile-preview-header" style="display: flex; gap: 18px; align-items: center; flex-wrap: wrap;">
            <div class="profile-avatar-container" style="position: relative; flex-shrink: 0;">
              <img src="${avatar}" alt="${escapeHtml(name)}" class="profile-preview-avatar" style="width: 84px; height: 84px; border-radius: 20px; object-fit: cover; border: 2.5px solid #ffffff; box-shadow: 0 4px 14px rgba(26,26,26, 0.18);">
              <span class="profile-verified-badge" title="Verified Passenger" style="position: absolute; bottom: -4px; right: -4px; background: linear-gradient(135deg, #10b981, #059669); color: white; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.15); font-size: 11px;">
                <i data-lucide="check" style="width: 13px; height: 13px; stroke-width: 3;"></i>
              </span>
            </div>

            <div class="profile-preview-details" style="flex: 1; min-width: 200px;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                <span class="eyebrow" style="color: var(--brand-blue); font-weight: 800; letter-spacing: 0.5px; margin: 0;">TAXIBEE PASSENGER</span>
                <span class="status-chip status-chip--success" style="font-size: 0.68rem; font-weight: 800; padding: 2px 7px;"><i data-lucide="shield-check" style="width: 11px; height: 11px;"></i> Verified VIP</span>
              </div>
              <h2 style="margin: 0 0 6px 0; font-size: 1.45rem; font-weight: 850; color: var(--brand-blue-dark);">${escapeHtml(name)}</h2>
              <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--slate); font-size: 0.84rem; font-weight: 600;">
                <span style="display: inline-flex; align-items: center; gap: 5px;"><i data-lucide="phone" style="width: 13px; height: 13px; color: var(--brand-blue);"></i> ${escapeHtml(phone)}</span>
                <span>·</span>
                <span style="display: inline-flex; align-items: center; gap: 5px;"><i data-lucide="mail" style="width: 13px; height: 13px; color: var(--brand-blue);"></i> ${escapeHtml(email)}</span>
              </div>
            </div>

            <div style="flex-shrink: 0;">
              <button class="button button--primary button--small" type="button" data-action="edit-profile" style="border-radius: 12px; font-weight: 750; padding: 9px 16px; display: inline-flex; align-items: center; gap: 7px; box-shadow: 0 4px 12px rgba(26, 26, 26, 0.2);">
                <i data-lucide="user-pen" style="width: 16px; height: 16px;"></i> Edit Profile & Photo
              </button>
            </div>
          </div>

          <div class="profile-stats-row" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 18px; padding-top: 16px; border-top: 1px dashed var(--border-strong);">
            <div class="profile-stat-box" style="background: rgba(255, 255, 255, 0.8); border: 1px solid var(--border); border-radius: 14px; padding: 10px 14px;">
              <span class="muted text-small" style="display: block; font-size: 0.72rem; font-weight: 700;">Completed Travels</span>
              <strong style="font-size: 1.1rem; color: var(--brand-blue-dark); font-weight: 850;">14 Journeys</strong>
            </div>
            <div class="profile-stat-box" style="background: rgba(255, 255, 255, 0.8); border: 1px solid var(--border); border-radius: 14px; padding: 10px 14px;">
              <span class="muted text-small" style="display: block; font-size: 0.72rem; font-weight: 700;">Wallet Balance</span>
              <strong style="font-size: 1.1rem; color: var(--brand-blue); font-weight: 850;">${formatUGX(state.walletBalance)}</strong>
            </div>
            <div class="profile-stat-box" style="background: rgba(255, 255, 255, 0.8); border: 1px solid var(--border); border-radius: 14px; padding: 10px 14px;">
              <span class="muted text-small" style="display: block; font-size: 0.72rem; font-weight: 700;">Passenger Status</span>
              <strong style="font-size: 1.1rem; color: #10b981; font-weight: 850;">Active · Regular</strong>
            </div>
          </div>
        </article>

        <article class="card"><div class="card-head"><h2>Passenger information</h2></div><div class="detail-list"><div class="detail-row"><span>Preferred route</span><strong>Entebbe → Kampala</strong></div><div class="detail-row"><span>Emergency contact</span><strong>${escapeHtml(emergency)}</strong></div><div class="detail-row"><span>Saved passengers</span><strong>2 passengers</strong></div><div class="detail-row"><span>Saved pickup points</span><strong>Entebbe Main Stage, Kitooro</strong></div></div></article><article class="card"><div class="card-head"><div><p class="section-kicker">Accessibility</p><h2>Display and interaction</h2></div></div><div class="settings-list"><div class="settings-row"><span class="settings-row__icon"><i data-lucide="case-upper"></i></span><span class="settings-row__copy"><strong>Larger text</strong><span>Increase the interface type scale</span></span><button class="switch ${document.body.classList.contains('large-text') ? 'is-on' : ''}" type="button" data-action="accessibility" data-value="large-text"><span></span></button></div><div class="settings-row"><span class="settings-row__icon"><i data-lucide="contrast"></i></span><span class="settings-row__copy"><strong>High contrast</strong><span>Increase borders and text contrast</span></span><button class="switch ${document.body.classList.contains('high-contrast') ? 'is-on' : ''}" type="button" data-action="accessibility" data-value="high-contrast"><span></span></button></div><div class="settings-row"><span class="settings-row__icon"><i data-lucide="pause"></i></span><span class="settings-row__copy"><strong>Reduce motion</strong><span>Limit transitions and animations</span></span><button class="switch ${document.body.classList.contains('reduce-motion') ? 'is-on' : ''}" type="button" data-action="accessibility" data-value="reduce-motion"><span></span></button></div><div class="settings-row"><span class="settings-row__icon"><i data-lucide="audio-lines"></i></span><span class="settings-row__copy"><strong>Screen-reader labels</strong><span>Accessible labels are included throughout</span></span><span class="status-chip status-chip--success">On</span></div></div></article></div><aside class="grid"><article class="card"><h3>Account and preferences</h3><div class="settings-list">${profileRow('Saved passengers','users','Manage frequent travellers','saved-passengers')}${profileRow('Saved pickup points','map-pinned','Manage common boarding points','saved-pickups')}${profileRow('Wallet security','shield-check','PIN and Auto-Pay settings','wallet-pin')}${profileRow('Notification preferences','bell-ring','Choose alert categories','notification-preferences')}${profileRow('Language','languages',state.language,'language')}${profileRow('Privacy','lock-keyhole','Review privacy preview','privacy')}${profileRow('Terms and Conditions','file-check-2','Demonstration terms','terms')}${profileRow('Security & Login Logs','shield-check',`Audit trail (${getLoginLogs().length} logins recorded)`,'view-login-logs')}${profileRow('About Taxibee','info','Organization and app details','about')}</div></article><article class="card"><p class="section-kicker">Reviewer tools</p><button class="button button--ghost w-full" type="button" data-action="open-demo-panel"><i data-lucide="flask-conical"></i>Prototype Demo States</button><button class="button button--soft-red w-full" style="margin-top:10px" type="button" data-action="sign-out"><i data-lucide="log-out"></i>Sign Out</button></article></aside></section>`;
}
function profileRow(title, icon, copy, action) { return `<button class="settings-row" type="button" ${action === 'about' ? 'data-screen="about"' : `data-action="${action}"`}><span class="settings-row__icon"><i data-lucide="${icon}"></i></span><span class="settings-row__copy"><strong>${title}</strong><span>${copy}</span></span><i data-lucide="chevron-right"></i></button>`; }

function renderAbout() {
  return `
    <section class="about-hero"><div class="logo-frame logo-frame--large"><img src="assets/peebee-logo.svg" alt="Taxibee by Peebee logo"></div><p class="eyebrow">About the organization</p><h1>Taxibee by Peebee</h1><p class="muted">A demonstration passenger experience for reliable travel, parcel delivery, luggage handling and digital ticketing between Entebbe and Kampala.</p></section>
    <section class="service-list">${aboutService('Passenger transport','bus-front','Scheduled, stage-based travel with clear departure and boarding information.')}${aboutService('Parcel delivery','package-check','Traceable same-corridor parcels with collection verification.')}${aboutService('Luggage handling','luggage','Published categories, digital tags and formal handling notices.')}${aboutService('Digital ticketing','qr-code','Booking references, verification codes and branded digital tickets.')}${aboutService('Customer wallet','wallet-cards','Prepaid demonstration funds, promotions and refund states.')}${aboutService('Customer support','headphones','Trip, parcel, luggage, payment and lost-property requests.')}</section>
    <section class="grid grid--2" style="margin-top:18px"><article class="card"><h2>Demonstration contacts</h2><div class="detail-list"><div class="detail-row"><span>Passenger support</span><strong>+256 700 000 000</strong></div><div class="detail-row"><span>Parcel desk</span><strong>+256 700 000 001</strong></div><div class="detail-row"><span>Email</span><strong>hello@example.taxibee.demo</strong></div><div class="detail-row"><span>Office hours</span><strong>5:00 AM – 10:00 PM</strong></div></div><p class="privacy-note">All contact information above is placeholder demonstration content.</p></article><article class="card"><h2>Application information</h2><div class="detail-list"><div class="detail-row"><span>Application</span><strong>Taxibee Passenger App</strong></div><div class="detail-row"><span>Version</span><strong>1.2.0 Prototype</strong></div><div class="detail-row"><span>Data storage</span><strong>Browser memory only</strong></div><div class="detail-row"><span>Operational services</span><strong>None connected</strong></div></div><div class="button-row" style="margin-top:14px"><button class="button button--ghost button--small" type="button" data-action="terms">Terms</button><button class="button button--ghost button--small" type="button" data-action="privacy">Privacy</button></div></article></section>`;
}
function aboutService(title, icon, copy) { return `<article class="service-item"><i data-lucide="${icon}"></i><h3 style="margin:10px 0 7px">${title}</h3><p class="muted text-small" style="margin:0">${copy}</p></article>`; }
function getDriverAvatar(driverNameKey) {
  const key = (driverNameKey || '').toLowerCase().trim();
  const driver = driversData[key] || driversData['isaac muwonge'];
  return driver ? driver.avatar : 'assets/driver_1-branded.png';
}

function getActiveTrackingItems() {
  const travelItems = [];

  if (state.activeTrip && state.activeTrip.boarding) {
    const t = state.activeTrip;
    travelItems.push({
      id: 'FET-CURRENT',
      type: 'travel',
      title: `${t.boarding} → ${t.destination}`,
      route: `${t.boarding} → ${t.destination}`,
      vehicle: `${t.plate || 'UBM 245K'} (${t.vehicle || 'Hiace'})`,
      seat: 'Seat #4',
      time: `${formatDemoDate(state.bookingDate)} · ${t.depart || '8:30 AM'}`,
      eta: 'En Route (65%)',
      status: 'Active Trip',
      statusClass: 'status-chip--gold',
      driver: t.driverName || 'Moses Mukasa',
      driverKey: (t.driverName || 'moses mukasa').toLowerCase(),
      avatar: getDriverAvatar(t.driverName || 'Moses Mukasa')
    });
  }

  travelItems.push({
    id: 'FET-884210',
    type: 'travel',
    title: 'Entebbe → Kampala Corridor',
    route: 'Entebbe Bus Park → Kampala Railway Stage',
    vehicle: 'UBM 245K (Coaster)',
    seat: 'Seat #4',
    time: 'Today · 8:30 AM',
    eta: 'En Route (65%)',
    status: 'Active • On Route',
    statusClass: 'status-chip--info',
    driver: 'Isaac Muwonge',
    driverKey: 'isaac muwonge',
    avatar: 'assets/driver_1-branded.png'
  });

  const parcelItems = [
    {
      id: '#964201832-DL',
      type: 'parcel',
      title: 'Package from Entebbe',
      route: 'Entebbe Main Stage → Kampala Taxi Park',
      tariff: 'Small box',
      weight: '520 g',
      recipient: 'Joan Nankya',
      status: 'In Transit • On the way',
      statusClass: 'status-chip--gold',
      driver: 'Moses Mukasa',
      driverKey: 'moses mukasa',
      avatar: 'assets/driver_2-branded.png'
    },
    {
      id: '#964201710-DL',
      type: 'parcel',
      title: 'Documents to Kampala',
      route: 'Entebbe Stage → Bweyogerere Stage',
      tariff: 'Documents',
      weight: '280 g',
      recipient: 'Mark Ochieng',
      status: 'Delivered Today',
      statusClass: 'status-chip--success',
      driver: 'John Ssekabira',
      driverKey: 'john ssekabira',
      avatar: 'assets/driver_3-branded.png'
    }
  ];

  return { travelItems, parcelItems };
}

let trackingCardMapInstances = [];

function initTrackingCardMaps() {
  trackingCardMapInstances.forEach(m => {
    if (m) {
      try { m.remove(); } catch(e) {}
    }
  });
  trackingCardMapInstances = [];

  const { travelItems, parcelItems } = getActiveTrackingItems();
  const currentTab = state.trackingTab || 'all';

  let filteredItems = [];
  if (currentTab === 'travels') filteredItems = travelItems;
  else if (currentTab === 'parcels') filteredItems = parcelItems;
  else filteredItems = [...travelItems, ...parcelItems];

  const outbound = [[0.0618, 32.4742], [0.0934, 32.4705], [0.1340, 32.5220], [0.1870, 32.5350], [0.2185, 32.5398], [0.2480, 32.5550], [0.2680, 32.5650], [0.2880, 32.5680], [0.2990, 32.5720], [0.3122, 32.5883]];

  filteredItems.forEach((item, idx) => {
    const container = document.getElementById(`tracking-card-map-${idx}`);
    if (!container || !window.L) return;

    try {
      const miniMap = L.map(container, {
        attributionControl: false,
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false
      });

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: false }).addTo(miniMap);

      L.polyline(outbound, { color: '#0a0a0a', opacity: 0.6, weight: 6 }).addTo(miniMap);
      L.polyline(outbound, { color: '#c9a227', dashArray: '6 6', lineCap: 'round', opacity: 1, weight: 3.5 }).addTo(miniMap);

      L.circleMarker(outbound[0], { color: '#fff', fillColor: '#10b981', fillOpacity: 1, radius: 6, weight: 2.5 }).addTo(miniMap);
      L.circleMarker(outbound[outbound.length - 1], { color: '#fff', fillColor: '#ef4444', fillOpacity: 1, radius: 6, weight: 2.5 }).addTo(miniMap);

      const vehiclePos = item.type === 'travel' ? outbound[5] : (idx % 2 === 0 ? outbound[3] : outbound[7]);
      L.circleMarker(vehiclePos, {
        color: '#ffffff',
        fillColor: item.type === 'travel' ? '#c9a227' : '#f2a104',
        fillOpacity: 1,
        radius: 8,
        weight: 3
      }).addTo(miniMap);

      const bounds = L.latLngBounds(outbound);
      miniMap.fitBounds(bounds, { padding: [20, 20] });
      trackingCardMapInstances.push(miniMap);
    } catch(err) {
      console.warn('Mini map init error:', err);
    }
  });
}

function renderTrackingHubCard(item, idx) {
  const isTravel = item.type === 'travel';
  return `
    <div class="card tracking-hub-card" style="padding: 0; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 24px; box-shadow: 0 8px 30px rgba(26,26,26,0.08); background: white;">
      <!-- Real Leaflet Map Thumbnail Container (Rounded Inset Map) -->
      <div class="tracking-card-map-preview" style="position: relative; height: 165px; margin: 12px 12px 0 12px; border-radius: 20px; border: 1px solid rgba(26,26,26,0.08); background: #faf8ef; overflow: hidden; box-shadow: 0 4px 14px rgba(26,26,26,0.06);">
        <div id="tracking-card-map-${idx}" style="position: absolute; inset: 0; z-index: 1;"></div>
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(26,26,26,0.15) 0%, rgba(26,26,26,0.78) 100%); pointer-events: none; z-index: 2;"></div>

        <!-- Top Badges Overlay -->
        <div style="position: absolute; top: 12px; left: 14px; right: 14px; display: flex; align-items: center; justify-content: space-between; z-index: 3; pointer-events: auto;">
          <span style="background: rgba(255,255,255,0.95); color: var(--brand-blue-dark); font-weight: 850; font-size: 0.76rem; padding: 4px 12px; border-radius: 14px; backdrop-filter: blur(8px); display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
            <i data-lucide="${isTravel ? 'bus-front' : 'package'}" style="width:14px;height:14px;color:var(--brand-blue);"></i>
            ${isTravel ? 'Booked Travel' : 'Parcel Delivery'}
          </span>
          <span class="status-chip ${item.statusClass}" style="box-shadow: 0 4px 14px rgba(0,0,0,0.25);">
            <span class="pulse-dot"></span> ${item.status}
          </span>
        </div>

        <!-- Bottom Route Header Overlay -->
        <div style="position: absolute; bottom: 12px; left: 14px; right: 14px; color: white; z-index: 3; pointer-events: none;">
          <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.9; font-weight: 750; display: block;">Ref #${item.id}</span>
          <strong style="font-size: 1.05rem; font-weight: 850; line-height: 1.25; margin-top: 2px; color: white; display: block;">${item.route}</strong>
        </div>
      </div>

      <!-- Card Body Content -->
      <div style="padding: 16px;">
        <!-- Specs Grid -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: var(--surface-alt); border: 1px solid var(--border-subtle); padding: 12px; border-radius: 16px; margin-bottom: 14px; text-align: center;">
          ${isTravel ? `
            <div>
              <span style="display: block; font-size: 0.7rem; color: var(--slate); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">Vehicle</span>
              <strong style="font-size: 0.84rem; color: var(--brand-blue-dark); font-weight: 850;">${item.vehicle}</strong>
            </div>
            <div>
              <span style="display: block; font-size: 0.7rem; color: var(--slate); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">Seat / Time</span>
              <strong style="font-size: 0.84rem; color: var(--brand-blue-dark); font-weight: 850;">${item.seat} • ${item.time}</strong>
            </div>
            <div>
              <span style="display: block; font-size: 0.7rem; color: var(--slate); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">Status</span>
              <strong style="font-size: 0.84rem; color: var(--brand-blue-dark); font-weight: 850;">${item.eta}</strong>
            </div>
          ` : `
            <div>
              <span style="display: block; font-size: 0.7rem; color: var(--slate); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">Tariff</span>
              <strong style="font-size: 0.84rem; color: var(--brand-blue-dark); font-weight: 850;">${item.tariff}</strong>
            </div>
            <div>
              <span style="display: block; font-size: 0.7rem; color: var(--slate); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">Weight</span>
              <strong style="font-size: 0.84rem; color: var(--brand-blue-dark); font-weight: 850;">${item.weight}</strong>
            </div>
            <div>
              <span style="display: block; font-size: 0.7rem; color: var(--slate); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">To</span>
              <strong style="font-size: 0.84rem; color: var(--brand-blue-dark); font-weight: 850;">${item.recipient}</strong>
            </div>
          `}
        </div>

        <!-- Driver Info Row -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="showDriverProfileModal('${item.driverKey}');">
            <img src="${item.avatar}" alt="${item.driver}" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid var(--brand-blue);">
            <div>
              <strong style="display: block; font-size: 0.9rem; color: var(--brand-blue-dark); line-height: 1.2; font-weight: 850;">${item.driver}</strong>
              <span style="font-size: 0.75rem; color: var(--slate); font-weight: 600;">Assigned Driver</span>
            </div>
          </div>

          <div style="display: flex; gap: 8px;">
            <button class="icon-button icon-button--small" type="button" data-action="modal-chat-driver" data-value="${item.driverKey}" aria-label="Chat driver" style="width: 38px; height: 38px; border-radius: 50%;"><i data-lucide="message-square"></i></button>
            <button class="icon-button icon-button--small" type="button" data-action="modal-call-driver" data-value="${item.driverKey}" aria-label="Call driver" style="width: 38px; height: 38px; border-radius: 50%;"><i data-lucide="phone"></i></button>
          </div>
        </div>

        <!-- Primary Track Button -->
        <button class="button button--primary w-full" type="button" data-action="open-single-tracking" data-id="${item.id}" style="height: 48px; border-radius: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.92rem;">
          <i data-lucide="navigation"></i> Track Live Navigation
        </button>
      </div>
    </div>
  `;
}

function renderTracking() {
  const { travelItems, parcelItems } = getActiveTrackingItems();
  const currentTab = state.trackingTab || 'all';

  let filteredItems = [];
  if (currentTab === 'travels') {
    filteredItems = travelItems;
  } else if (currentTab === 'parcels') {
    filteredItems = parcelItems;
  } else {
    filteredItems = [...travelItems, ...parcelItems];
  }

  // Check if viewing single item map view
  if (state.trackingView === 'single') {
    const selectedItem = filteredItems.find(i => i.id === state.selectedTrackingId) || filteredItems[0] || travelItems[0];
    const isTravel = selectedItem.type === 'travel';

    return `
      <div class="tracking-unified-container">
        <div class="tracking-fullscreen-map-wrapper">
          <div id="unified-tracking-map" class="tracking-map-canvas"></div>
          <div id="unified-tracking-map-fallback" class="trip-map-fallback" style="background: #faf8ef; z-index: 2;" hidden>
            <img src="assets/taxibee-minivan-branded.png" alt="" style="width: 54px; height: 54px; border-radius: 50%; object-fit: cover; margin-bottom: 6px;">
            <strong style="font-size: 0.95rem; color: var(--brand-blue-dark);">Connecting Live Navigation Map...</strong>
          </div>

          <!-- Floating Top Bar with Back Button -->
          <div class="tracking-top-nav-bar" style="justify-content: space-between; padding: 12px 16px;">
            <button type="button" class="button button--secondary" data-action="back-to-tracking-hub" style="height: 40px; padding: 0 16px; border-radius: 20px; font-weight: 800; gap: 6px; box-shadow: 0 4px 14px rgba(26,26,26,0.15); background: white; border: 1px solid var(--border-subtle); color: var(--brand-blue-dark);">
              <i data-lucide="arrow-left"></i> Back to Hub
            </button>

            <div class="tracking-top-status-pill" style="box-shadow: 0 4px 14px rgba(26,26,26,0.15);">
              <span class="pulse-dot"></span>
              <span>${selectedItem.status}</span>
            </div>
          </div>

          <!-- Floating Bottom Navigation Sheet -->
          <div class="tracking-bottom-nav-card">
            <div class="tracking-bottom-nav-card__header">
              <div>
                <span class="tracking-bottom-nav-card__label">${isTravel ? 'TRAVEL TICKET ID' : 'DELIVERY ID'}</span>
                <strong class="tracking-bottom-nav-card__id">${selectedItem.id}</strong>
              </div>
              <span class="status-chip ${selectedItem.statusClass}">${selectedItem.status}</span>
            </div>

            <div class="tracking-bottom-nav-card__grid">
              ${isTravel ? `
                <div class="tracking-bottom-nav-card__grid-item">
                  <span class="tracking-bottom-nav-card__grid-label">Route</span>
                  <strong class="tracking-bottom-nav-card__grid-val">${selectedItem.route}</strong>
                </div>
                <div class="tracking-bottom-nav-card__grid-item">
                  <span class="tracking-bottom-nav-card__grid-label">Vehicle</span>
                  <strong class="tracking-bottom-nav-card__grid-val">${selectedItem.vehicle}</strong>
                </div>
                <div class="tracking-bottom-nav-card__grid-item">
                  <span class="tracking-bottom-nav-card__grid-label">Departure</span>
                  <strong class="tracking-bottom-nav-card__grid-val">${selectedItem.time}</strong>
                </div>
              ` : `
                <div class="tracking-bottom-nav-card__grid-item">
                  <span class="tracking-bottom-nav-card__grid-label">Tariff</span>
                  <strong class="tracking-bottom-nav-card__grid-val">${selectedItem.tariff}</strong>
                </div>
                <div class="tracking-bottom-nav-card__grid-item">
                  <span class="tracking-bottom-nav-card__grid-label">Weight</span>
                  <strong class="tracking-bottom-nav-card__grid-val">${selectedItem.weight}</strong>
                </div>
                <div class="tracking-bottom-nav-card__grid-item">
                  <span class="tracking-bottom-nav-card__grid-label">To</span>
                  <strong class="tracking-bottom-nav-card__grid-val">${selectedItem.recipient}</strong>
                </div>
              `}
            </div>

            <hr class="tracking-bottom-nav-card__divider">

            <div class="tracking-bottom-nav-card__driver">
              <div class="tracking-bottom-nav-card__driver-left" role="button" tabindex="0" onclick="showDriverProfileModal('${selectedItem.driverKey}');" style="cursor: pointer;">
                <img src="${selectedItem.avatar}" alt="${selectedItem.driver}" class="tracking-bottom-nav-card__avatar">
                <div class="tracking-bottom-nav-card__driver-info">
                  <strong>${selectedItem.driver}</strong>
                  <span>Taxibee Driver</span>
                </div>
              </div>
              <div class="tracking-bottom-nav-card__actions">
                <button class="tracking-circle-btn" type="button" data-action="modal-chat-driver" data-value="${selectedItem.driverKey}" aria-label="Chat with driver"><i data-lucide="message-square"></i></button>
                <button class="tracking-circle-btn" type="button" data-action="modal-call-driver" data-value="${selectedItem.driverKey}" aria-label="Call driver"><i data-lucide="phone"></i></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Default Tracking Hub Overview Screen
  return `
    ${screenHead('Live Tracking & Journey Hub', 'Track your active booked travels and parcel deliveries with map previews.')}

    <!-- Category Filter Tabs (Standard App Tabs) -->
    <div class="tabs" role="tablist" style="margin-bottom: 20px;">
      <button class="tab ${currentTab === 'all' ? 'is-active' : ''}" type="button" data-action="set-tracking-tab" data-value="all">
        All Active (${travelItems.length + parcelItems.length})
      </button>
      <button class="tab ${currentTab === 'travels' ? 'is-active' : ''}" type="button" data-action="set-tracking-tab" data-value="travels">
        Travels (${travelItems.length})
      </button>
      <button class="tab ${currentTab === 'parcels' ? 'is-active' : ''}" type="button" data-action="set-tracking-tab" data-value="parcels">
        Parcels (${parcelItems.length})
      </button>
    </div>

    <!-- Active Tracking Cards List -->
    ${filteredItems.length > 0 ? `
      <div class="tracking-cards-grid" style="display: flex; flex-direction: column; gap: 20px; max-width: 650px; margin: 0 auto;">
        ${filteredItems.map((item, idx) => renderTrackingHubCard(item, idx)).join('')}
      </div>
    ` : `
      <div class="card" style="max-width: 500px; margin: 20px auto; text-align: center; padding: 36px 20px; border-radius: 24px;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: #faf8ef; color: var(--brand-blue); display: grid; place-items: center; margin: 0 auto 14px;">
          <i data-lucide="${currentTab === 'parcels' ? 'package-x' : 'bus-front'}" style="width: 28px; height: 28px;"></i>
        </div>
        <h3 style="margin: 0 0 6px; font-size: 1.15rem; color: var(--brand-blue-dark); font-weight: 850;">No Active ${currentTab === 'parcels' ? 'Parcels' : 'Booked Travels'}</h3>
        <p style="margin: 0 0 18px; font-size: 0.85rem; color: var(--slate);">You don't have any active ${currentTab === 'parcels' ? 'parcel deliveries' : 'booked journeys'} in progress right now.</p>
        <button class="button button--primary" type="button" data-screen="${currentTab === 'parcels' ? 'parcel' : 'book'}" style="margin: 0 auto; height: 44px; padding: 0 20px; border-radius: 14px; font-weight: 800;">
          <i data-lucide="${currentTab === 'parcels' ? 'package-plus' : 'ticket'}"></i> ${currentTab === 'parcels' ? 'Send a Parcel Now' : 'Book a Travel'}
        </button>
      </div>
    `}
  `;
}

/* =========================================================
   Streamlined booking review
   Optional choices stay collapsed until a passenger needs them.
   ========================================================= */

let tripReviewMap = null;
let tripReviewScrollFrame = null;
let bookingStep2Map = null;
let liveTravelMap = null;
let liveVehicleMarker = null;

function getCurrentRoutePoints(routeKey, isReverse = false) {
  const outbound = [[0.0618, 32.4742], [0.0934, 32.4705], [0.1340, 32.5220], [0.1870, 32.5350], [0.2185, 32.5398], [0.2480, 32.5550], [0.2680, 32.5650], [0.2880, 32.5680], [0.2990, 32.5720], [0.3122, 32.5883]];
  let rawPoints = outbound;
  const route = routeKey || state.selectedRoute || 'entebbe';
  if (route === 'bweyogere') {
    rawPoints = [...outbound, [0.3200, 32.6100], [0.3400, 32.6350], [0.3470, 32.6490]];
  } else if (route === 'busega') {
    rawPoints = outbound.slice(0, 5).concat([[0.2500, 32.5250], [0.2800, 32.5150], [0.3100, 32.5200]]);
  } else if (route === 'nambole') {
    rawPoints = [...outbound, [0.3200, 32.6100], [0.3400, 32.6350], [0.3480, 32.6570]];
  } else if (route === 'masaka') {
    rawPoints = outbound.slice(0, 5).concat([[0.2500, 32.5250], [0.2200, 32.4500], [0.1500, 32.2000], [0.0200, 32.0000], [-0.1500, 31.9000], [-0.3400, 31.7400]]);
  } else if (route === 'lyantonde') {
    rawPoints = outbound.slice(0, 5).concat([[0.2500, 32.5250], [0.2200, 32.4500], [0.1500, 32.2000], [0.0200, 32.0000], [-0.1500, 31.9000], [-0.3400, 31.7400], [-0.3800, 31.4000], [-0.4000, 31.1550]]);
  } else if (route === 'mbarara') {
    rawPoints = outbound.slice(0, 5).concat([[0.2500, 32.5250], [0.2200, 32.4500], [0.1500, 32.2000], [0.0200, 32.0000], [-0.1500, 31.9000], [-0.3400, 31.7400], [-0.3800, 31.4000], [-0.4000, 31.1550], [-0.5000, 30.9000], [-0.6050, 30.6550]]);
  }
  return isReverse ? rawPoints.slice().reverse() : rawPoints;
}

function updateHeaderTheme() {
  const topbar = $('.topbar');
  if (!topbar) return;
  const isScrolled = window.scrollY > 50;
  const darkHeroScreens = ['trip-details', 'live'];
  if (darkHeroScreens.includes(state.screen) && !isScrolled) {
    topbar.classList.add('topbar--dark-bg');
    topbar.classList.remove('topbar--light-bg');
  } else {
    topbar.classList.add('topbar--light-bg');
    topbar.classList.remove('topbar--dark-bg');
  }
}

function handleTripReviewScroll() {
  updateHeaderTheme();
}

function passengerTotal() {
  return state.passengerCount + state.reservedChildSeatsCount;
}

function getOccupiedSeatsForTrip(trip) {
  const allSeatNames = ['1A', '1B', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C', '5A', '5B', '5C'];
  if (!trip) return [];
  const totalSeats = allSeatNames.length;
  const availableCount = Math.min(totalSeats, trip.seats);
  const occupiedCount = Math.max(0, totalSeats - availableCount);
  
  let hash = 0;
  for (let i = 0; i < trip.id.length; i++) {
    hash = trip.id.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const shuffled = [...allSeatNames];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.abs((hash + i) % (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  
  return shuffled.slice(0, occupiedCount);
}

function getDropOffOptions() {
  const from = state.searchFrom;
  const to = state.searchTo;
  const allStages = appData.routes;
  const fromIndex = allStages.indexOf(from);
  const toIndex = allStages.indexOf(to);
  
  if (fromIndex === -1 || toIndex === -1) {
    return [to];
  }
  
  const min = Math.min(fromIndex, toIndex);
  const max = Math.max(fromIndex, toIndex);
  let slice = allStages.slice(min, max + 1);
  
  if (fromIndex > toIndex) {
    slice.reverse();
  }
  
  // Origin itself is not a drop-off point, so filter it out
  slice = slice.filter(stage => stage !== from);
  
  return slice;
}

function getMaxAvailableSeats() {
  const routeTrips = appData.trips.filter(t => t.boarding === state.searchFrom && t.destination === state.searchTo);
  if (!routeTrips.length) return 14;
  return Math.max(...routeTrips.map(t => t.seats));
}

function tripReviewFare() {
  const baseFare = (state.ticketType === 'return' ? 9000 : 5000) * passengerTotal();
  return baseFare + seatReservationFee() + luggageTotal();
}

function luggageSummary() {
  const paidItems = appData.luggage.reduce((sum, item) => sum + (item.id === 'personal' ? 0 : state.luggageQuantities[item.id] || 0), 0);
  if (!paidItems) return 'Personal item included';
  return `${paidItems} additional item${paidItems === 1 ? '' : 's'} · ${formatUGX(luggageTotal())}`;
}

function bookingAccordion(key, icon, title, summary, body) {
  const open = state.bookingOption === key;
  return `<section class="booking-accordion ${open ? 'is-open' : ''}">
    <button class="booking-accordion__trigger" type="button" data-action="booking-option" data-value="${key}" aria-expanded="${open}" aria-controls="booking-option-${key}">
      <span class="booking-accordion__icon"><i data-lucide="${icon}"></i></span>
      <span class="booking-accordion__copy"><strong>${title}</strong><span>${summary}</span></span>
      <i class="booking-accordion__chevron" data-lucide="chevron-down"></i>
    </button>
    <div id="booking-option-${key}" class="booking-accordion__panel" ${open ? '' : 'hidden'}>${body}</div>
  </section>`;
}

function reviewReturnOptions() {
  if (state.ticketType !== 'return') {
    return `<div class="compact-option-intro"><div><strong>Add a discounted return</strong><p>Secure the outbound and return together for ${formatUGX(9000 * passengerTotal())}.</p></div><button class="button button--primary button--small" type="button" data-action="quick-return-toggle">Add Return</button></div>`;
  }
  const options = [
    ['same-day','calendar-check','Same-day','Return on an eligible departure today'],
    ['date-specific','calendar-days','Choose date','Reserve the return date now'],
    ['open','calendar-range','Open return','Choose an eligible departure later'],
    ['promotional','sparkles','Promotional','Campaign validity applies']
  ];
  return `<div class="compact-choice-grid">${options.map(([value, icon, title, copy]) => `<button class="compact-choice ${state.returnMode === value ? 'is-selected' : ''}" type="button" data-action="return-mode" data-value="${value}" aria-pressed="${state.returnMode === value}"><i data-lucide="${icon}"></i><span><strong>${title}</strong><small>${copy}</small></span></button>`).join('')}</div>
    ${state.returnMode === 'date-specific' ? `<div class="field compact-field"><label for="review-return-date">Return date</label><input id="review-return-date" type="date" value="${state.returnDate}" data-field="return-date"></div>` : ''}
    <div class="compact-note"><i data-lucide="clock-3"></i><span>${state.returnMode === 'open' ? 'Use this return before 21 July 2026 at 10:00 PM.' : state.returnMode === 'same-day' ? 'Eligible on same-day departures with available capacity.' : state.returnMode === 'promotional' ? 'Promotional conditions and expiry will appear on your ticket.' : 'Your chosen return date will be printed on the ticket.'}</span></div>`;
}

function reviewPassengerOptions() {
  return `<div class="compact-steppers">
      <div><span><strong>Adults</strong><small>Age 13 and above</small></span><div class="stepper"><button type="button" data-action="decrease-passengers" aria-label="Remove adult">−</button><span>${state.passengerCount}</span><button type="button" data-action="add-adult" aria-label="Add adult">+</button></div></div>
      <div><span><strong>Children</strong><small>Age 12 and below</small></span><div class="stepper"><button type="button" data-action="decrease-child" aria-label="Remove child">−</button><span>${state.childCount}</span><button type="button" data-action="add-child" aria-label="Add child">+</button></div></div>
    </div>
    <div class="compact-note"><i data-lucide="users-round"></i><span>Passenger names and emergency details are prefilled for this demo. <button class="text-button" type="button" data-screen="passengers">Review full passenger details</button></span></div>`;
}

function reviewAssistanceOptions() {
  const assistance = ['None required','Boarding assistance','Priority seating','Mobility support'];
  const languages = ['English','Luganda','Swahili'];
  return `<p class="field-label">Assistance</p><div class="choice-pills">${assistance.map(value => `<button class="choice-pill ${state.assistance === value ? 'is-selected' : ''}" type="button" data-action="set-assistance" data-value="${value}" aria-pressed="${state.assistance === value}">${value}</button>`).join('')}</div>
    <p class="field-label compact-label">Preferred language</p><div class="choice-pills">${languages.map(value => `<button class="choice-pill ${state.language === value ? 'is-selected' : ''}" type="button" data-action="set-language-inline" data-value="${value}" aria-pressed="${state.language === value}">${value}</button>`).join('')}</div>
    <div class="language-preview">${state.language === 'Luganda' ? 'Oli mwetegefu okutambula?' : state.language === 'Swahili' ? 'Uko tayari kusafiri?' : 'Are you ready to travel?'}</div>`;
}

function reviewLuggageOptions() {
  return `<div class="compact-luggage-list">${appData.luggage.map(item => `<div class="compact-luggage-row"><span class="luggage-icon"><i data-lucide="${item.icon}"></i></span><span><strong>${item.name}</strong><small>${item.guide} · ${formatUGX(item.price)}</small></span><div class="stepper"><button type="button" data-action="luggage-minus" data-id="${item.id}" aria-label="Remove ${item.name}" ${item.id === 'personal' && state.luggageQuantities.personal <= 1 ? 'disabled' : ''}>−</button><span>${state.luggageQuantities[item.id] || 0}</span><button type="button" data-action="luggage-plus" data-id="${item.id}" aria-label="Add ${item.name}">+</button></div></div>`).join('')}</div>
    <div class="compact-note"><i data-lucide="shield-check"></i><span>Fragile and commercial items are reviewed at the stage. A digital luggage tag is issued with your ticket.</span></div>`;
}

function reviewSeatOptions() {
  const fee = seatReservationFee();
  return `<div class="mode-switch compact-mode-switch">
    <button class="${state.capacityMode === 'capacity' ? 'is-active' : ''}" type="button" data-action="capacity-mode" data-value="capacity" aria-pressed="${state.capacityMode === 'capacity'}">Best available</button>
    <button class="${state.capacityMode === 'seats' ? 'is-active' : ''}" type="button" data-action="capacity-mode" data-value="seats" aria-pressed="${state.capacityMode === 'seats'}">Choose seats</button>
  </div>
  ${state.capacityMode === 'seats' ? `
    <div class="compact-note" style="background: var(--info-soft); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; text-align: left;">
      <i data-lucide="info" style="color: var(--brand-blue);"></i>
      <span>Specific seat reservation adds an extra fee of <strong>UGX 1,000 per seat</strong>.</span>
    </div>
    ${renderSeatMode()}
  ` : ''}`;
}

function renderSeatMode() {
  const occupiedList = getOccupiedSeatsForTrip(state.activeTrip);
  const isHighroof = state.activeTrip && state.activeTrip.vehicle && state.activeTrip.vehicle.toLowerCase() === 'highroof';

  // 14-seater Commuter layout (existing)
  const seats14 = [
    ['1A',29.2,29.3], ['1B',45.5,29.3],
    ['2A',28.7,43.3], ['2B',53.2,43.3], ['2C',69.6,43.3],
    ['3A',28.7,57.0], ['3B',53.2,57.0], ['3C',69.6,57.0],
    ['4A',28.7,70.7], ['4B',53.2,70.7], ['4C',69.6,70.7],
    ['5A',31.3,84.1], ['5B',49.8,84.1], ['5C',68.1,84.1]
  ];

  // 18-seater Highroof layout (mapped to new top-down image)
  const seats18 = [
    // Row 1 (Front): 2 seats next to driver
    ['1A', 23.5, 29.5], ['1B', 43.5, 29.5],
    // Row 2 (Back Row 1): 4 seats
    ['2A', 23.0, 43.5], ['2B', 39.5, 43.5], ['2C', 56.0, 43.5], ['2D', 72.5, 43.5],
    // Row 3 (Back Row 2): 4 seats
    ['3A', 23.0, 57.5], ['3B', 39.5, 57.5], ['3C', 56.0, 57.5], ['3D', 72.5, 57.5],
    // Row 4 (Back Row 3): 4 seats
    ['4A', 23.0, 71.5], ['4B', 39.5, 71.5], ['4C', 56.0, 71.5], ['4D', 72.5, 71.5],
    // Row 5 (Back Row 4): 4 seats
    ['5A', 24.5, 85.5], ['5B', 40.0, 85.5], ['5C', 56.0, 85.5], ['5D', 72.0, 85.5]
  ];

  const seats = isHighroof ? seats18 : seats14;
  const imgSrc = isHighroof ? 'assets/taxibee-highroof-topdown.png' : 'assets/taxibee-14-seater.png';
  const imgAlt = isHighroof ? 'Top view of the Taxibee 18-seater Highroof interior' : 'Top view of the Taxibee 14-seater Commuter interior';
  const seatCount = isHighroof ? 18 : 14;
  const driverLeft = isHighroof ? '72.0' : '67.9';
  const driverTop = isHighroof ? '29.5' : '29.4';

  return `<div class="photo-seat-selector ${isHighroof ? 'is-highroof' : ''}" role="group" aria-labelledby="photo-seat-title">
    <span id="photo-seat-title" class="sr-only">Choose passenger seats in the ${seatCount}-seater vehicle</span>
    <img src="${imgSrc}" alt="${imgAlt}"><span class="seat-brand-front" aria-hidden="true"></span><span class="seat-brand-back" aria-hidden="true">TAXIBEE</span><span class="seat-brand-stripe" aria-hidden="true"></span>
    ${seats.map(([seat,left,top]) => {
      const isOccupied = occupiedList.includes(seat);
      const isSelected = state.selectedSeats.includes(seat);
      return `<button class="photo-seat ${isSelected ? 'is-selected' : ''} ${isOccupied ? 'is-occupied' : ''}" style="--seat-left:${left}%;--seat-top:${top}%" type="button" ${isOccupied ? 'disabled' : 'data-action="toggle-seat"'} data-seat="${seat}" aria-pressed="${isSelected}" aria-label="${isOccupied ? `Occupied seat ${seat}` : isSelected ? `Deselect seat ${seat}` : `Select seat ${seat}`}"><span>${seat}</span><i data-lucide="${isOccupied ? 'x' : 'check'}"></i></button>`;
    }).join('')}
    <button class="photo-seat photo-seat--driver" style="--seat-left:${driverLeft}%;--seat-top:${driverTop}%" type="button" disabled aria-label="Driver seat, not selectable"><span>Driver</span><i data-lucide="gauge"></i></button>
  </div>
  <div class="photo-seat-legend">
    <span><i class="photo-seat-key"></i>Available</span>
    <span><i class="photo-seat-key photo-seat-key--selected"></i>Selected</span>
    <span><i class="photo-seat-key photo-seat-key--occupied"></i>Occupied</span>
    <span><i class="photo-seat-key photo-seat-key--driver"></i>Driver · unavailable</span>
  </div>
  <p class="seat-selection-count" role="status" aria-live="polite"><strong>${state.selectedSeats.length} of ${passengerTotal()}</strong> passenger seat${passengerTotal() === 1 ? '' : 's'} selected</p>`;
}


function destroyTripMap() {
  if (tripReviewMap) {
    tripReviewMap.remove();
    tripReviewMap = null;
  }
  if (parcelMap) {
    parcelMap.remove();
    parcelMap = null;
  }
  if (bookingStep2Map) {
    bookingStep2Map.remove();
    bookingStep2Map = null;
  }
  if (liveTravelMap) {
    liveTravelMap.remove();
    liveTravelMap = null;
  }
}

function initTripMap() {
  const target = $('#trip-review-map');
  const fallback = $('#trip-map-fallback');
  if (fallback) fallback.hidden = false;
  if (!target) return;
  if (!window.L) {
    if (fallback) fallback.hidden = false;
    return;
  }

  if (tripReviewMap) {
    tripReviewMap.remove();
    tripReviewMap = null;
  }

  let routeKey = state.selectedRoute || 'entebbe';
  if (state.activeTrip) {
    const boarding = state.activeTrip.boarding.toLowerCase();
    const destination = state.activeTrip.destination.toLowerCase();
    const rc = appData.routeCards.find(r => 
      (boarding.includes(r.cityA.toLowerCase()) && destination.includes(r.cityB.toLowerCase())) ||
      (boarding.includes(r.cityB.toLowerCase()) && destination.includes(r.cityA.toLowerCase()))
    );
    if (rc) routeKey = rc.key;
  }
  
  const isReverse = state.activeTrip ? state.activeTrip.boarding.toLowerCase().includes('kampala') || state.activeTrip.boarding.toLowerCase().includes('bweyogere') || state.activeTrip.boarding.toLowerCase().includes('busega') || state.activeTrip.boarding.toLowerCase().includes('nambole') || state.activeTrip.boarding.toLowerCase().includes('masaka') || state.activeTrip.boarding.toLowerCase().includes('lyantonde') || state.activeTrip.boarding.toLowerCase().includes('mbarara') : false;
  const points = getCurrentRoutePoints(routeKey, isReverse);
  tripReviewMap = L.map(target, { attributionControl: true, boxZoom: true, doubleClickZoom: true, dragging: true, keyboard: true, scrollWheelZoom: false, touchZoom: true, zoomControl: true });
  let tileErrors = 0;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: false, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
  tiles.on('tileload', () => { if (fallback) fallback.hidden = true; });
  tiles.on('tileerror', () => { tileErrors += 1; if (tileErrors > 2 && fallback) fallback.hidden = false; });
  tiles.addTo(tripReviewMap);
  setTimeout(() => { if (fallback) fallback.hidden = true; }, 150);
  
  L.polyline(points, { color: '#0a0a0a', opacity: .55, weight: 8 }).addTo(tripReviewMap);
  L.polyline(points, { color: '#c9a227', dashArray: '8 9', lineCap: 'round', opacity: 1, weight: 4 }).addTo(tripReviewMap);
  
  L.circleMarker(points[0], { color: '#fff', fillColor: '#10b981', fillOpacity: 1, radius: 9, weight: 4 }).addTo(tripReviewMap);
  L.circleMarker(points[points.length - 1], { color: '#fff', fillColor: '#ef4444', fillOpacity: 1, radius: 9, weight: 4 }).addTo(tripReviewMap);
  
  if (state.activeTrip) {
    const markerIdx = state.activeTrip.markerIndex !== undefined ? state.activeTrip.markerIndex : 0;
    const vehiclePoint = points[Math.min(points.length - 1, markerIdx)];
    L.circleMarker(vehiclePoint, { color: '#fff', fillColor: '#f2a104', fillOpacity: 1, radius: 10, weight: 4 }).addTo(tripReviewMap);
  }
  
  const bounds = L.latLngBounds(points);
  const fitMap = () => {
    if (!tripReviewMap || !target.isConnected) return;
    tripReviewMap.invalidateSize({ animate: false, pan: false });
    tripReviewMap.fitBounds(bounds, { animate: false, padding: [20, 20] });
  };
  fitMap();
  requestAnimationFrame(() => requestAnimationFrame(fitMap));
  setTimeout(fitMap, 320);
}

function initBookingStep2Map() {
  const target = $('#booking-step2-map');
  const fallback = $('#booking-step2-map-fallback');
  if (fallback) fallback.hidden = false;
  if (!target) return;
  if (!window.L) {
    if (fallback) fallback.hidden = false;
    return;
  }
  
  const route = state.selectedRoute || 'entebbe';
  const rc = appData.routeCards.find(r => r.key === route);
  const fromCity = (state.searchFrom || '').toLowerCase();
  const isFlipped = !!state.routeFlips[route] || 
                    (rc && fromCity.includes(rc.cityB.toLowerCase())) ||
                    fromCity.includes('kampala') || fromCity.includes('bweyogere') || 
                    fromCity.includes('nambole') || fromCity.includes('masaka') || 
                    fromCity.includes('lyantonde') || fromCity.includes('mbarara');
  const points = getCurrentRoutePoints(route, isFlipped);
  
  if (bookingStep2Map) {
    bookingStep2Map.remove();
    bookingStep2Map = null;
  }
  
  bookingStep2Map = L.map(target, { attributionControl: false, boxZoom: true, doubleClickZoom: true, dragging: true, keyboard: true, scrollWheelZoom: false, touchZoom: true, zoomControl: true });
  
  let tileErrors = 0;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: false });
  tiles.on('tileload', () => { if (fallback) fallback.hidden = true; });
  tiles.on('tileerror', () => { tileErrors += 1; if (tileErrors > 2 && fallback) fallback.hidden = false; });
  tiles.addTo(bookingStep2Map);
  setTimeout(() => { if (fallback) fallback.hidden = true; }, 150);
  
  L.polyline(points, { color: '#0a0a0a', opacity: .55, weight: 8 }).addTo(bookingStep2Map);
  L.polyline(points, { color: '#c9a227', dashArray: '8 9', lineCap: 'round', opacity: 1, weight: 4 }).addTo(bookingStep2Map);
  
  L.circleMarker(points[0], { color: '#fff', fillColor: '#10b981', fillOpacity: 1, radius: 9, weight: 4 }).addTo(bookingStep2Map);
  L.circleMarker(points[points.length - 1], { color: '#fff', fillColor: '#ef4444', fillOpacity: 1, radius: 9, weight: 4 }).addTo(bookingStep2Map);
  
  const bounds = L.latLngBounds(points);
  const fitMap = () => {
    if (!bookingStep2Map || !target.isConnected) return;
    bookingStep2Map.invalidateSize({ animate: false, pan: false });
    bookingStep2Map.fitBounds(bounds, { animate: false, padding: [20, 20] });
  };
  fitMap();
  requestAnimationFrame(() => requestAnimationFrame(fitMap));
  setTimeout(fitMap, 320);

  // Parallax scroll handler
  const handleScroll = () => {
    if (!target.isConnected) {
      window.removeEventListener('scroll', handleScroll);
      return;
    }
    const scrollY = window.scrollY;
    target.style.transform = `translate3d(0, ${Math.min(100, scrollY * 0.35)}px, 0)`;
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
}

function initLiveTravelMap() {
  const target = $('#live-travel-map');
  const fallback = $('#live-travel-map-fallback');
  if (fallback) fallback.hidden = false;
  if (!target) return;
  if (!window.L) {
    if (fallback) fallback.hidden = false;
    return;
  }
  
  let routeKey = state.selectedRoute || 'entebbe';
  if (state.activeTrip) {
    const boarding = state.activeTrip.boarding.toLowerCase();
    const destination = state.activeTrip.destination.toLowerCase();
    const rc = appData.routeCards.find(r => 
      (boarding.includes(r.cityA.toLowerCase()) && destination.includes(r.cityB.toLowerCase())) ||
      (boarding.includes(r.cityB.toLowerCase()) && destination.includes(r.cityA.toLowerCase()))
    );
    if (rc) routeKey = rc.key;
  }
  
  const isReverse = state.activeTrip ? state.activeTrip.boarding.toLowerCase().includes('kampala') || state.activeTrip.boarding.toLowerCase().includes('bweyogere') || state.activeTrip.boarding.toLowerCase().includes('busega') || state.activeTrip.boarding.toLowerCase().includes('nambole') || state.activeTrip.boarding.toLowerCase().includes('masaka') || state.activeTrip.boarding.toLowerCase().includes('lyantonde') || state.activeTrip.boarding.toLowerCase().includes('mbarara') : false;
  
  const points = getCurrentRoutePoints(routeKey, isReverse);
  if (liveTravelMap) {
    liveTravelMap.remove();
    liveTravelMap = null;
  }
  
  liveTravelMap = L.map(target, { attributionControl: false, boxZoom: true, doubleClickZoom: true, dragging: true, keyboard: true, scrollWheelZoom: false, touchZoom: true, zoomControl: true });
  
  let tileErrors = 0;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: false });
  tiles.on('tileload', () => { if (fallback) fallback.hidden = true; });
  tiles.on('tileerror', () => { tileErrors += 1; if (tileErrors > 2 && fallback) fallback.hidden = false; });
  tiles.addTo(liveTravelMap);
  setTimeout(() => { if (fallback) fallback.hidden = true; }, 150);
  
  L.polyline(points, { color: '#0a0a0a', opacity: .55, weight: 8 }).addTo(liveTravelMap);
  L.polyline(points, { color: '#c9a227', dashArray: '8 9', lineCap: 'round', opacity: 1, weight: 4 }).addTo(liveTravelMap);
  
  L.circleMarker(points[0], { color: '#fff', fillColor: '#10b981', fillOpacity: 1, radius: 9, weight: 4 }).addTo(liveTravelMap);
  L.circleMarker(points[points.length - 1], { color: '#fff', fillColor: '#ef4444', fillOpacity: 1, radius: 9, weight: 4 }).addTo(liveTravelMap);
  
  const startProgressIdx = Math.floor((state.routeProgress / 100) * points.length);
  const vehiclePoint = points[Math.min(points.length - 1, startProgressIdx)];
  
  const plate = state.activeTrip ? state.activeTrip.plate : 'UBM 245K';
  const countdown = state.activeTrip ? state.activeTrip.countdown : 'Live tracking';
  
  liveVehicleMarker = L.circleMarker(vehiclePoint, { color: '#fff', fillColor: '#f2a104', fillOpacity: 1, radius: 10, weight: 4 })
    .bindTooltip(`Live: ${plate} (${countdown})`, { permanent: true, direction: 'top', offset: [0, -14], className: 'trip-map-vehicle-label' })
    .addTo(liveTravelMap);
    
  const bounds = L.latLngBounds(points);
  const fitMap = () => {
    if (!liveTravelMap || !target.isConnected) return;
    liveTravelMap.invalidateSize({ animate: false, pan: false });
    liveTravelMap.fitBounds(bounds, { animate: false, padding: [40, 40] });
  };
  fitMap();
  requestAnimationFrame(() => requestAnimationFrame(fitMap));
  setTimeout(fitMap, 320);
}

function bookingPaymentStatus() {
  if (state.luggageQuantities.commercial) return 'Luggage Fee Pending';
  if (state.paymentMethod === 'cash') return 'Payment Pending';
  if (state.paymentMethod === 'mobile' && state.paymentDemoState === 'pending') return 'Payment Pending';
  if (state.paymentMethod === 'corporate') return 'Awaiting Approval';
  return 'Paid';
}

function displayReturnType() {
  if (state.ticketType !== 'return') return 'One Way';
  const labels = { 'same-day': 'Same-day Return', 'date-specific': 'Date-specific Return', open: 'Open Return', promotional: 'Promotional Return' };
  return labels[state.returnMode] || 'Return Ticket';
}

function getCityImage(stage) {
  if (!stage) return 'assets/kampala.jpg';
  const lower = stage.toLowerCase();
  if (lower.includes('entebbe')) return 'assets/entebbe.jpg';
  if (lower.includes('masaka')) return 'assets/masaka.jpg';
  if (lower.includes('lyantonde')) return 'assets/lyantonde.jpg';
  if (lower.includes('mbarara')) return 'assets/mbarara.jpg';
  if (lower.includes('nambole')) return 'assets/nambole.jpg';
  return 'assets/kampala.jpg';
}

function getCityLabel(stage) {
  if (!stage) return 'Kampala';
  const lower = stage.toLowerCase();
  if (lower.includes('entebbe')) return 'Entebbe';
  if (lower.includes('masaka')) return 'Masaka';
  if (lower.includes('lyantonde')) return 'Lyantonde';
  if (lower.includes('mbarara')) return 'Mbarara';
  if (lower.includes('nambole')) return 'Nambole';
  return 'Kampala';
}

let unifiedTrackingMap = null;

function initTrackingMap() {
  const target = $('#unified-tracking-map');
  const fallback = $('#unified-tracking-map-fallback');
  if (fallback) fallback.hidden = false;
  if (!target) return;
  if (!window.L) {
    if (fallback) fallback.hidden = false;
    return;
  }

  if (unifiedTrackingMap) {
    unifiedTrackingMap.remove();
    unifiedTrackingMap = null;
  }

  const currentTab = state.trackingTab || 'parcels';
  const outbound = [[0.0618, 32.4742], [0.0934, 32.4705], [0.1340, 32.5220], [0.1870, 32.5350], [0.2185, 32.5398], [0.2480, 32.5550], [0.2680, 32.5650], [0.2880, 32.5680], [0.2990, 32.5720], [0.3122, 32.5883]];

  unifiedTrackingMap = L.map(target, { attributionControl: false, boxZoom: true, doubleClickZoom: true, dragging: true, keyboard: true, zoomControl: true });

  let tileErrors = 0;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: false });
  tiles.on('tileload', () => { if (fallback) fallback.hidden = true; });
  tiles.on('tileerror', () => { tileErrors += 1; if (tileErrors > 2 && fallback) fallback.hidden = false; });
  tiles.addTo(unifiedTrackingMap);
  setTimeout(() => { if (fallback) fallback.hidden = true; }, 150);

  L.polyline(outbound, { color: '#0a0a0a', opacity: 0.5, weight: 8 }).addTo(unifiedTrackingMap);
  L.polyline(outbound, { color: '#c9a227', dashArray: '8 9', lineCap: 'round', opacity: 1, weight: 4 }).addTo(unifiedTrackingMap);

  L.circleMarker(outbound[0], { color: '#fff', fillColor: '#10b981', fillOpacity: 1, radius: 9, weight: 4 }).bindTooltip('Entebbe Main Stage', { permanent: false }).addTo(unifiedTrackingMap);
  L.circleMarker(outbound[outbound.length - 1], { color: '#fff', fillColor: '#ef4444', fillOpacity: 1, radius: 9, weight: 4 }).bindTooltip('Kampala Station', { permanent: false }).addTo(unifiedTrackingMap);

  if (currentTab === 'parcels') {
    L.circleMarker(outbound[3], { color: '#fff', fillColor: '#f2a104', fillOpacity: 1, radius: 10, weight: 4 })
      .bindTooltip('Parcel: #964201832-DL (On the way)', { permanent: true, direction: 'top', offset: [0, -14], className: 'trip-map-vehicle-label' })
      .addTo(unifiedTrackingMap);
  } else if (currentTab === 'travels') {
    L.circleMarker(outbound[5], { color: '#fff', fillColor: '#c9a227', fillOpacity: 1, radius: 10, weight: 4 })
      .bindTooltip('Travel: UBM 245K (En Route)', { permanent: true, direction: 'top', offset: [0, -14], className: 'trip-map-vehicle-label' })
      .addTo(unifiedTrackingMap);
  } else {
    L.circleMarker(outbound[2], { color: '#fff', fillColor: '#10b981', fillOpacity: 1, radius: 9, weight: 4 })
      .bindTooltip('Isaac Muwonge (On Road)', { permanent: true, direction: 'top', offset: [0, -14], className: 'trip-map-vehicle-label' })
      .addTo(unifiedTrackingMap);
    L.circleMarker(outbound[6], { color: '#fff', fillColor: '#10b981', fillOpacity: 1, radius: 9, weight: 4 })
      .bindTooltip('David Okello (In Transit)', { permanent: true, direction: 'top', offset: [0, -14], className: 'trip-map-vehicle-label' })
      .addTo(unifiedTrackingMap);
  }

  const bounds = L.latLngBounds(outbound);
  const fitMap = () => {
    if (!unifiedTrackingMap || !target.isConnected) return;
    unifiedTrackingMap.invalidateSize({ animate: false, pan: false });
    unifiedTrackingMap.fitBounds(bounds, { animate: false, padding: [40, 40] });
  };
  fitMap();
  requestAnimationFrame(() => requestAnimationFrame(fitMap));
  setTimeout(fitMap, 300);
}

function formatDemoDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function renderSuccess() {
  const paymentStatus = bookingPaymentStatus();
  const trip = state.activeTrip;
  return `<section class="success-screen" aria-labelledby="success-title">
    <div class="success-check"><i data-lucide="check"></i></div>
    <p class="eyebrow">Booking successful</p><h1 id="success-title" tabindex="-1">Your trip is reserved</h1><p class="muted">This complete booking is simulated in browser memory and resets on refresh.</p>
    <div class="booking-reference"><i data-lucide="copy"></i>FX-260718-1842</div>
    <article class="card" style="text-align:left"><div class="detail-list"><div class="detail-row"><span>Route</span><strong>${trip.boarding} → ${trip.destination}</strong></div>${state.dropOffLocation !== state.searchTo ? `<div class="detail-row"><span>Custom Drop-off Point</span><strong>${escapeHtml(state.dropOffLocation)}</strong></div>` : ''}<div class="detail-row"><span>Departure</span><strong>${formatDemoDate(state.bookingDate)} · ${trip.depart}</strong></div><div class="detail-row"><span>Vehicle</span><strong>${trip.plate}</strong></div><div class="detail-row"><span>Passengers</span><strong>${passengerTotal()}</strong></div>${state.isBookingForSomeoneElse ? `<div class="detail-row"><span>Primary Passenger</span><strong>${escapeHtml(state.passengerDetails[0]?.name || 'Christo I.')} (${escapeHtml(state.passengerDetails[0]?.phone || '+256 772 345 678')})</strong></div>` : ''}<div class="detail-row"><span>Ticket</span><strong>${displayReturnType()}</strong></div>${state.ticketType === 'return' && state.returnMode === 'date-specific' ? `<div class="detail-row"><span>Return date</span><strong>${formatDemoDate(state.returnDate)}</strong></div>` : ''}<div class="detail-row"><span>Amount</span><strong>${formatUGX(checkoutTotal())}${state.luggageQuantities.commercial ? ' + stage assessment' : ''}</strong></div><div class="detail-row"><span>Payment method</span><strong>${paymentLabel()}</strong></div><div class="detail-row"><span>Payment status</span><strong class="${paymentStatus === 'Paid' ? 'text-success' : ''}">${paymentStatus}</strong></div></div></article>
    <div class="button-row" style="justify-content:center;margin-top:18px"><button class="button button--primary" type="button" data-screen="ticket"><i data-lucide="ticket-check"></i>View Ticket</button><button class="button button--ghost" type="button" data-action="calendar-demo"><i data-lucide="calendar-plus"></i>Add to Calendar</button><button class="button button--ghost" type="button" data-action="share-demo"><i data-lucide="share-2"></i>Share Ticket</button><button class="button button--ghost" type="button" data-screen="home">Return Home</button></div>
  </section>`;
}

function ticketLifecycle() {
  const paymentStatus = bookingPaymentStatus();
  if (state.ticketStatus !== 'active') return state.ticketStatus;
  return paymentStatus === 'Paid' ? 'active' : 'payment-pending';
}

function renderTicket() {
  const trip = state.activeTrip;
  const lifecycle = ticketLifecycle();
  const statusLabels = { active: 'Active', used: 'Used', expired: 'Expired', cancelled: 'Cancelled', 'payment-pending': 'Payment Pending' };
  const statusIcons = { active: 'circle-check-big', used: 'ticket-check', expired: 'timer-off', cancelled: 'ticket-x', 'payment-pending': 'clock-3' };
  const statusClass = lifecycle === 'active' ? 'status-chip--success' : lifecycle === 'cancelled' || lifecycle === 'expired' ? 'status-chip--danger' : 'status-chip--warning';
  const statusCopy = lifecycle === 'active' ? 'Ready for boarding' : lifecycle === 'used' ? 'Already verified for travel' : lifecycle === 'expired' ? 'Outside its validity window' : lifecycle === 'cancelled' ? 'Booking cancelled · refund pending' : 'Complete payment at the stage or await approval';
  const luggageItems = appData.luggage.filter(item => (state.luggageQuantities[item.id] || 0) > 0).map(item => `${state.luggageQuantities[item.id]} × ${item.name}`).join(', ');
  return `${screenHead('Digital passenger ticket', 'Present this QR code or the six-digit verification code when boarding.', '<button class="button button--ghost" type="button" data-action="ticket-states"><i data-lucide="layers-3"></i>Preview States</button>')}
    <article class="digital-ticket">
      <header class="ticket-header"><div class="ticket-brand"><div class="logo-frame logo-frame--ticket"><img src="assets/peebee-logo.svg" alt="Taxibee logo"></div><div><h2>Taxibee</h2><p>Passenger Digital Ticket</p></div></div></header>
      <div class="ticket-status-banner ticket-status-banner--${lifecycle}"><i data-lucide="${statusIcons[lifecycle]}"></i><span><strong>${statusLabels[lifecycle]}</strong><small>${statusCopy}</small></span></div>
      <div class="ticket-body">
        <div class="ticket-route"><div class="ticket-route__place"><span>FROM</span><strong>${trip.boarding.replace(' Main Stage','')}</strong><span>${trip.boarding.includes('Main Stage') ? 'Main Stage' : 'Pickup stage'}</span></div><div class="ticket-route__arrow"><i data-lucide="arrow-right"></i></div><div class="ticket-route__place"><span>TO</span><strong>${state.dropOffLocation.replace(' Main Stage','')}</strong><span>${state.dropOffLocation.includes('Main Stage') ? 'Main Stage' : 'Drop-off stage'}</span></div></div>
        <div class="ticket-grid">
          ${ticketField('Passenger',escapeHtml(state.passengerDetails[0]?.name || appData.passenger.name))}${ticketField('Booking reference','FX-260718-1842')}${ticketField('Ticket number','FET-884210')}${ticketField('Travel date',formatDemoDate(state.bookingDate))}${ticketField('Departure',trip.depart)}${ticketField('Boarding time','15 minutes before departure')}${ticketField('Vehicle',trip.plate)}${ticketField('Ticket type',displayReturnType())}${ticketField('Passengers',String(passengerTotal()))}${ticketField('Capacity reference',state.capacityMode === 'seats' ? state.selectedSeats.join(', ') : 'Best available · Position 04')}${ticketField('Payment status',bookingPaymentStatus())}${ticketField('Fare paid',`${formatUGX(checkoutTotal())}${state.luggageQuantities.commercial ? ' + stage assessment' : ''}`)}${ticketField('Luggage',luggageItems || '1 × Small personal item')}${ticketField('Assistance',state.assistance)}${ticketField('Language',state.language)}${ticketField('Return validity',state.ticketType === 'return' ? (state.returnMode === 'date-specific' ? formatDemoDate(state.returnDate) : 'Until 21 Jul 2026 · 10 PM') : 'Not applicable')}
        </div>
        <div class="ticket-code-area"><div id="ticket-qr" class="ticket-qr-real" aria-label="Scannable demonstration QR code"></div><div><p class="section-kicker">Verification code</p><div class="verification-code">482 915</div><p class="muted text-small">The code verifies this simulated ticket only.</p></div></div>
      </div>
      <div class="ticket-perforation"></div>
      <footer class="ticket-actions">${lifecycle === 'payment-pending' ? `<button class="button button--primary button--small" type="button" data-action="change-seats-unpaid"><i data-lucide="armchair"></i>Change Seats</button>` : ''}<button class="button button--primary button--small" type="button" data-action="download-demo"><i data-lucide="download"></i>Download Ticket</button><button class="button button--ghost button--small" type="button" data-action="share-demo"><i data-lucide="share-2"></i>Share</button><button class="button button--ghost button--small" type="button" data-screen="tracking"><i data-lucide="route"></i>View Route</button><button class="button button--ghost button--small" type="button" data-screen="support"><i data-lucide="headphones"></i>Support</button><button class="button button--soft-red button--small" type="button" data-action="cancel-booking"><i data-lucide="x"></i>Cancel Booking</button></footer>
    </article>`;
}

function initQrFor(elementId, qrText) {
  const target = document.getElementById(elementId);
  if (!target) return;
  target.innerHTML = '';
  if (!window.QRCode) {
    target.innerHTML = `<div class="qr-code">${generateQr()}</div>`;
    return;
  }
  try {
    new QRCode(target, { text: qrText, width: 140, height: 140, colorDark: '#0a0a0a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } catch(e) {
    target.innerHTML = `<div class="qr-code">${generateQr()}</div>`;
  }
}

function initTicketQr() {
  initQrFor('ticket-qr', `TAXIBEE|FX-260718-1842|FET-884210|${state.activeTrip?.plate || 'UBM245K'}|482915`);
}

function initParcelBarcode() {
  const target = $('#parcel-barcode');
  if (!target) return;
  if (!window.JsBarcode) {
    target.setAttribute('viewBox', '0 0 360 92');
    target.innerHTML = '<text x="180" y="52" text-anchor="middle" font-size="18" font-family="sans-serif" fill="#0a0a0a">#964201832-DL</text>';
    return;
  }
  JsBarcode(target, '964201832-DL', { format: 'CODE128', width: 2, height: 72, displayValue: true, fontSize: 15, lineColor: '#0a0a0a', margin: 8 });
}

/* =========================================================
   Interaction handling
   ========================================================= */

function handleClick(event) {
  if (document.body.classList.contains('drawer-open')) {
    if (!event.target.closest('#side-drawer, [aria-controls="side-drawer"]')) {
      closeSideDrawer();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  const dotTrigger = event.target.closest('[data-dot]');
  if (dotTrigger) {
    const index = Number(dotTrigger.dataset.dot);
    const carousel = $('#departureCarousel');
    const card = carousel?.querySelector(`[data-card-index="${index}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    return;
  }

  const screenTrigger = event.target.closest('[data-screen]');
  if (screenTrigger) {
    const screen = screenTrigger.dataset.screen;
    if (screenTrigger.dataset.actionPayload) {
      try {
        const payload = JSON.parse(screenTrigger.dataset.actionPayload);
        Object.assign(state, payload);
      } catch (e) {}
    }
    if (screenTrigger.dataset.driver) {
      state.viewingDriverName = screenTrigger.dataset.driver.toLowerCase();
    }

    if (screen === 'driver-profile') {
      showDriverProfileModal(state.viewingDriverName);
      closeSideDrawer();
      closeSheet();
      return;
    }
    
    // Set booking steps when navigating from sidebar submenus
    if (screen === 'returns') {
      state.bookingStep = 5;
      state.ticketType = 'return';
      state.tripType = 'return';
      navigate('book');
    } else if (screen === 'luggage') {
      state.bookingStep = 4;
      navigate('book');
    } else if (screen === 'book') {
      state.bookingStep = 1;
      navigate('book');
    } else if (screen === 'about') {
      navigate('about');
    } else {
      navigate(screen);
    }
    
    closeModal(); closeSheet(); closeSideDrawer();
    return;
  }

  const actionTrigger = event.target.closest('[data-action]');
  if (!actionTrigger) return;
  if ((actionTrigger.classList.contains('modal-backdrop') || actionTrigger.classList.contains('sheet-backdrop') || actionTrigger.classList.contains('side-drawer__backdrop')) && event.target !== actionTrigger) return;
  const action = actionTrigger.dataset.action;
  const value = actionTrigger.dataset.value;

  const actions = {
    'fill-creds': () => {
      const u = actionTrigger.dataset.user;
      const p = actionTrigger.dataset.pass;
      const uInput = $('#signin-username');
      const pInput = $('#signin-passcode');
      if (uInput && pInput) {
        uInput.value = u;
        pInput.value = p;
        toast(`Autofilled credentials for ${u}.`, 'info');
        $('#signin-error')?.classList.add('is-hidden');
        pInput.focus();
      }
    },
    'toggle-passcode-visibility': () => {
      const pInput = $('#signin-passcode');
      const toggleBtn = $('#toggle-passcode-btn');
      if (!pInput) return;
      if (pInput.type === 'password') {
        pInput.type = 'text';
        if (toggleBtn) toggleBtn.textContent = 'Hide passcode';
      } else {
        pInput.type = 'password';
        if (toggleBtn) toggleBtn.textContent = 'Show passcode';
      }
    },
    'submit-login': (e) => handlePlatformLogin(e),
    'view-login-logs': () => navigate('login-logs'),
    'export-logs-json': exportLoginLogsJSON,
    'export-logs-csv': exportLoginLogsCSV,
    'clear-login-logs': clearLoginLogs,
    'simulate-login-test': simulateTestLoginEvent,
    'filter-logs': () => {
      state.logFilter = value || 'all';
      renderCurrentScreen();
    },
    'continue-guest': () => {
      toast('Guest access is disabled. Please sign in with username and passcode.', 'warning');
      const pInput = $('#signin-passcode');
      if (pInput) pInput.focus();
    },
    'toggle-side-drawer': openSideDrawer,
    'close-drawer': closeSideDrawer,
    'skip-intro': () => showAuth('signin'),
    'skip-onboarding': () => showAuth('signin'),
    'onboarding-next': () => {
      if (state.onboardingIndex < onboardingSlides.length - 1) { state.onboardingIndex += 1; renderOnboarding(); }
      else showAuth('signin');
    },
    'onboarding-back': () => { state.onboardingIndex = Math.max(0, state.onboardingIndex - 1); renderOnboarding(); },
    'onboarding-go': () => { state.onboardingIndex = Number(actionTrigger.dataset.index); renderOnboarding(); },
    'continue-signin': () => { state.authView = 'otp'; renderAuth(); },
    'continue-google': () => { showLoading('Authenticating with Google…', () => enterApp('Signed in with Google as Christo I.')); },
    'proceed-reg-verification': () => { state.authView = 'create-verify'; renderAuth(); toast('Verification code sent via SMS to +256 772 345 678.', 'info'); },
    'continue-guest': () => enterApp('Guest preview opened. No account was created.'),
    'show-registration': () => { state.authView = 'register'; renderAuth(); },
    'auth-back': () => { state.authView = 'signin'; renderAuth(); },
    'change-number': () => { state.authView = 'signin'; renderAuth(); },
    'resend-otp': () => { startOtpCountdown(); toast('A new demonstration code is ready: 1234.', 'success'); },
    'verify-otp': () => verifyOtp(),
    'create-account': () => { showLoading('Creating demonstration profile…', () => enterApp('Demo account created for Christo I.')); },
    'go-back': goBack,
    'toggle-connection': toggleConnection,
    'trip-kind': () => { state.tripType = value; state.ticketType = value === 'return' ? 'return' : 'oneway'; renderCurrentScreen(); },
    'book-searched-route': () => {
      const route = actionTrigger.dataset.route;
      state.selectedRoute = route;
      state.bookingStep = 2;
      const rc = appData.routeCards.find(r => r.key === route);
      if (rc) {
        state.searchFrom = rc.stageA;
        state.searchTo = rc.stageB;
      }
      navigate('book');
    },
    'select-route-card': () => {
      const route = actionTrigger.dataset.route;
      state.selectedRoute = route;
      if (route === 'bweyogere') {
        state.searchFrom = 'Entebbe Main Stage';
        state.searchTo = 'Bweyogere';
      } else if (route === 'busega') {
        state.searchFrom = 'Entebbe Main Stage';
        state.searchTo = 'Kampala Main Stage';
      } else { // kajansi
        state.searchFrom = 'Kampala Main Stage';
        state.searchTo = 'Entebbe Main Stage';
      }
      renderCurrentScreen();
      toast('Route profile updated.', 'success');
    },
    'select-route-card-step': () => {
      const route = actionTrigger.dataset.route;
      if (state.selectedRoute === route) {
        state.selectedRoute = null;
        renderCurrentScreen();
        renderNavigation();
        toast('Route selection cleared.', 'success');
      } else {
        state.selectedRoute = route;
        const rc = appData.routeCards.find(r => r.key === route);
        if (rc) {
          const flipped = !!state.routeFlips[route];
          state.searchFrom = flipped ? rc.stageB : rc.stageA;
          state.searchTo = flipped ? rc.stageA : rc.stageB;
        }
        renderCurrentScreen();
        renderNavigation();
        toast('Route selected.', 'success');
      }
    },
    'flip-route-direction': () => {
      const route = actionTrigger.dataset.route;
      state.routeFlips[route] = !state.routeFlips[route];
      state.selectedRoute = route;
      const rc = appData.routeCards.find(r => r.key === route);
      if (rc) {
        const flipped = !!state.routeFlips[route];
        state.searchFrom = flipped ? rc.stageB : rc.stageA;
        state.searchTo = flipped ? rc.stageA : rc.stageB;
      }
      renderCurrentScreen();
      renderNavigation();
      const flipped = !!state.routeFlips[route];
      toast(`Direction: ${flipped ? rc.cityB : rc.cityA} → ${flipped ? rc.cityA : rc.cityB}`, 'success');
    },
    'decrement-adults': () => {
      state.passengerCount = Math.max(1, state.passengerCount - 1);
      renderCurrentScreen();
    },
    'increment-adults': () => {
      if (passengerTotal() < 18) {
        state.passengerCount++;
        renderCurrentScreen();
      } else {
        toast('Maximum capacity of 18 seats reached.', 'warning');
      }
    },
    'decrement-children': () => {
      state.childCount = Math.max(0, state.childCount - 1);
      // Auto-adjust reserved seats to match child count constraint
      state.reservedChildSeatsCount = Math.min(state.childCount, state.reservedChildSeatsCount);
      state.reservedChildSeatsCount = Math.max(state.reservedChildSeatsCount, state.childCount - 2);
      renderCurrentScreen();
    },
    'increment-children': () => {
      // Incrementing child count only increases seats if childCount >= 2 (which forces a reserved child seat)
      const forcesNewSeat = state.childCount >= 2;
      if (!forcesNewSeat || passengerTotal() < 18) {
        state.childCount++;
        // Auto-adjust reserved seats: a single passenger can't add > 2 children without automatically reserving a seat.
        state.reservedChildSeatsCount = Math.max(state.reservedChildSeatsCount, state.childCount - 2);
        renderCurrentScreen();
      } else {
        toast('Maximum capacity of 18 seats reached.', 'warning');
      }
    },
    'decrement-child-seats': () => {
      const minSeats = Math.max(0, state.childCount - 2);
      if (state.reservedChildSeatsCount > minSeats) {
        state.reservedChildSeatsCount--;
        renderCurrentScreen();
      } else {
        toast(`At least ${minSeats} seat(s) must be reserved for ${state.childCount} children.`, 'warning');
      }
    },
    'increment-child-seats': () => {
      if (passengerTotal() < 18) {
        if (state.reservedChildSeatsCount < state.childCount) {
          state.reservedChildSeatsCount++;
          renderCurrentScreen();
        } else {
          toast('Cannot reserve more child seats than the number of children.', 'warning');
        }
      } else {
        toast('Maximum capacity of 18 seats reached.', 'warning');
      }
    },
    'select-date-mode': () => {
      state.dateSelectionMode = value;
      if (value === 'today') {
        state.bookingDate = '2026-07-18'; // Reset to mockup standard today
      }
      renderCurrentScreen();
    },
    'book-preferred-seat': () => {
      state.capacityMode = 'seats';
      state.bookingStep = '3b';
      state.selectedSeats = [];
      renderCurrentScreen();
      toast('Seat selector opened. Choose your seats.', 'info');
    },
    'booking-skip-seat': () => {
      state.capacityMode = 'best';
      state.bookingStep = 4;
      renderCurrentScreen();
      toast('Proceeding with best available seat.', 'info');
    },
    'booking-next-step': () => {
      if (state.bookingStep === 2) {
        if (!state.searchPeriod) {
          toast('Please select a preferred period before proceeding.', 'warning');
          return;
        }
        if (!state.dropOffLocation) {
          toast('Please select a preferred drop-off point before proceeding.', 'warning');
          return;
        }
        if (state.isBookingForSomeoneElse) {
          if (!state.otherTravelerName || !state.otherTravelerName.trim()) {
            toast("Please enter the traveler's full name.", 'warning');
            return;
          }
          if (!state.otherTravelerPhone || !state.otherTravelerPhone.trim()) {
            toast("Please enter the traveler's phone number.", 'warning');
            return;
          }
        }
      }
      if (state.bookingStep === 3) {
        if (!state.activeTrip) {
          toast('Select a vehicle to continue.', 'warning');
          return;
        }
      }
      if (state.bookingStep === '3b') {
        const required = passengerTotal();
        if (state.selectedSeats.length !== required) {
          toast(`Please select exactly ${required} seat${required === 1 ? '' : 's'} to continue, or go back.`, 'warning');
          return;
        }
        state.bookingStep = 4;
      } else if (state.bookingStep === 4) {
        state.bookingStep = 6;
      } else {
        state.bookingStep = Math.min(6, state.bookingStep + 1);
      }
      renderCurrentScreen();
    },
    'booking-prev-step': () => {
      if (state.bookingStep === 6) {
        state.bookingStep = 4;
      } else if (state.bookingStep === 4) {
        state.bookingStep = state.capacityMode === 'seats' ? '3b' : 3;
      } else if (state.bookingStep === '3b') {
        state.bookingStep = 3;
      } else {
        state.bookingStep = Math.max(1, state.bookingStep - 1);
      }
      renderCurrentScreen();
    },
    'select-booking-vehicle': () => {
      const trip = appData.trips.find(t => t.id === actionTrigger.dataset.tripId) || appData.trips[0];
      state.activeTrip = trip;
      renderCurrentScreen();
      toast(`Vehicle ${trip.plate} selected. Choose seat assignment option.`, 'success');
    },
    'open-luggage-modal': () => {
      openLuggageConfigModal();
    },
    'modal-luggage-plus': () => {
      const id = actionTrigger.dataset.id;
      state.luggageQuantities[id] = (state.luggageQuantities[id] || 0) + 1;
      openLuggageConfigModal();
      renderCurrentScreen();
    },
    'modal-luggage-minus': () => {
      const id = actionTrigger.dataset.id;
      state.luggageQuantities[id] = Math.max(0, (state.luggageQuantities[id] || 0) - 1);
      openLuggageConfigModal();
      renderCurrentScreen();
    },
    'toggle-return-switch': () => {
      state.ticketType = state.ticketType === 'return' ? 'oneway' : 'return';
      state.tripType = state.ticketType === 'return' ? 'return' : 'oneway';
      renderCurrentScreen();
      toast(state.ticketType === 'return' ? 'Return trip package added.' : 'Return trip package removed.', 'success');
    },
    'toggle-book-for-someone-else': () => {
      state.isBookingForSomeoneElse = !state.isBookingForSomeoneElse;
      if (state.isBookingForSomeoneElse) {
        state.passengerDetails[0].name = state.otherTravelerName;
        state.passengerDetails[0].phone = state.otherTravelerPhone;
        toast('Booking for someone else enabled. Please enter their details.', 'success');
      } else {
        state.passengerDetails[0].name = 'Christo I.';
        state.passengerDetails[0].phone = '+256 772 345 678';
        toast('Booking for self enabled.', 'success');
      }
      renderCurrentScreen();
    },
    'confirm-booking-step': () => {
      confirmBooking();
    },
    'swap-home-route': () => {
      const btn = $('.home-swap-circle-btn');
      if (btn) btn.classList.toggle('is-rotated');
      
      const originNode = $('#route-text-origin');
      const destNode = $('#route-text-dest');
      if (originNode && destNode) {
        originNode.style.transition = 'opacity 0.2s, transform 0.2s';
        destNode.style.transition = 'opacity 0.2s, transform 0.2s';
        originNode.style.opacity = '0';
        destNode.style.opacity = '0';
        originNode.style.transform = 'translateY(-4px)';
        destNode.style.transform = 'translateY(4px)';
        
        setTimeout(() => {
          const temp = state.searchFrom;
          state.searchFrom = state.searchTo;
          state.searchTo = temp;
          originNode.innerText = state.searchFrom || 'Entebbe';
          destNode.innerText = state.searchTo || 'Kampala';
          
          originNode.style.opacity = '1';
          destNode.style.opacity = '1';
          originNode.style.transform = 'translateY(0)';
          destNode.style.transform = 'translateY(0)';
        }, 200);
      } else {
        const temp = state.searchFrom;
        state.searchFrom = state.searchTo;
        state.searchTo = temp;
        renderCurrentScreen();
      }
      toast('Route direction swapped.', 'success');
    },
    'toggle-order-summary': () => {
      state.orderSummaryOpen = !state.orderSummaryOpen;
      renderCurrentScreen();
    },
    'toggle-save-departure': () => {
      const depId = actionTrigger.dataset.depId;
      state.savedDepartures = state.savedDepartures || [];
      const idx = state.savedDepartures.indexOf(depId);
      let isSavedNow = false;
      if (idx > -1) {
        state.savedDepartures.splice(idx, 1);
      } else {
        state.savedDepartures.push(depId);
        isSavedNow = true;
      }
      
      const heartBtn = actionTrigger;
      if (heartBtn) {
        heartBtn.classList.toggle('is-saved');
        const useEl = heartBtn.querySelector('use');
        if (useEl) {
          useEl.setAttribute('href', isSavedNow ? '#i-heart-fill' : '#i-heart');
        }
        const icon = heartBtn.querySelector('i');
        if (icon) {
          icon.setAttribute('data-lucide', isSavedNow ? 'heart-handshake' : 'heart');
          refreshIcons();
        }
      }
      
      toast(isSavedNow ? 'Departure saved to favorites.' : 'Departure removed from favorites.', 'success');
    },
    'open-search-shortcuts': showSearchShortcuts,
    'swap-route': swapRoute,
    'search-trips': () => simulateNavigation('Searching demonstration departures…', 'book'),
    'select-departure': () => { const trip = appData.trips.find(t => t.depart === actionTrigger.dataset.trip) || appData.trips[0]; state.activeTrip = trip; navigate('trip-details'); },
    'select-departure-direct': () => {
      const tripId = actionTrigger.dataset.tripId;
      const trip = appData.trips.find(t => t.id === tripId) || appData.trips[0];
      state.activeTrip = trip;
      navigate('trip-details');
    },
    'choose-trip': () => { state.activeTrip = getSearchResults().find(t => t.id === actionTrigger.dataset.tripId) || getSearchResults()[0] || appData.trips[0]; navigate('trip-details'); },
    'show-search-filters': showSearchFilters,
    'apply-filters': () => { closeModal(); toast('Demonstration filters applied.', 'success'); },
    'search-anytime': () => toast('All departure periods are now included.', 'success'),
    'booking-option': () => { state.bookingOption = state.bookingOption === value ? '' : value; renderCurrentScreen(); },
    'quick-return-toggle': () => { state.ticketType = state.ticketType === 'return' ? 'oneway' : 'return'; state.tripType = state.ticketType === 'return' ? 'return' : 'oneway'; if (state.ticketType === 'return') state.returnMode = state.returnMode || 'open'; renderCurrentScreen(); toast(state.ticketType === 'return' ? 'Return trip added.' : 'Return trip removed.', 'success'); },
    'continue-to-checkout': () => navigate('checkout'),
    'change-seats-checkout': () => { state.bookingOption = 'seats'; navigate('trip-details'); },
    'change-seats-unpaid': () => { state.bookingOption = 'seats'; navigate('trip-details'); },
    'set-assistance': () => { state.assistance = value; renderCurrentScreen(); },
    'set-language-inline': () => { state.language = value; renderCurrentScreen(); },
    'capacity-mode': () => { state.capacityMode = value; renderCurrentScreen(); },
    'toggle-seat': () => toggleSeat(actionTrigger.dataset.seat),
    'add-adult': () => { state.passengerCount = Math.min(4, state.passengerCount + 1); renderCurrentScreen(); },
    'add-child': () => { state.childCount = Math.min(2, state.childCount + 1); renderCurrentScreen(); },
    'decrease-passengers': () => { state.passengerCount = Math.max(1, state.passengerCount - 1); renderCurrentScreen(); },
    'decrease-child': () => { state.childCount = Math.max(0, state.childCount - 1); renderCurrentScreen(); },
    'select-ticket-type': () => { state.ticketType = value; state.tripType = value === 'return' ? 'return' : 'oneway'; renderCurrentScreen(); toast(value === 'return' ? 'Discounted return package selected.' : 'One-way ticket selected.', 'success'); },
    'return-mode': () => { state.returnMode = value; state.ticketType = 'return'; state.tripType = 'return'; renderCurrentScreen(); },
    'luggage-plus': () => updateLuggage(actionTrigger.dataset.id, 1),
    'luggage-minus': () => updateLuggage(actionTrigger.dataset.id, -1),
    'no-luggage': noAdditionalLuggage,
    'payment-state': () => { state.paymentDemoState = value; renderCurrentScreen(); },
    'payment-reset': () => { state.paymentDemoState = 'idle'; renderCurrentScreen(); },
    'apply-voucher': applyVoucher,
    'confirm-booking': confirmBooking,
    'calendar-demo': () => toast('Calendar preview prepared. No calendar was changed.', 'success'),
    'share-demo': () => showShareModal(),
    'download-demo': () => toast('A download would be generated in the production application.', 'success'),
    'ticket-states': showTicketStates,
    'cancel-booking': showCancelBooking,
    'trip-tab': () => { state.tripTab = value; renderCurrentScreen(); },
    'filter-tickets': () => { state.ticketsFilter = value; renderCurrentScreen(); },
    'tracking-tab': () => { state.trackingTab = value; state.trackingView = 'hub'; renderCurrentScreen(); },
    'set-tracking-tab': () => { state.trackingTab = value; state.trackingView = 'hub'; renderCurrentScreen(); },
    'change-return': showReturnDateModal,
    'rate-trip': showRatingModal,
    'lost-item': () => openLostPropertyModal(),
    'share-trip': () => showShareModal('Share live trip'),
    'emergency': showEmergencyModal,
    'open-add-funds': openAddFunds,
    'wallet-filter': () => { state.walletFilter = value; renderCurrentScreen(); },
    'send-passenger': showSendPassenger,
    'toggle-switch': () => { actionTrigger.classList.toggle('is-on'); toast(`Setting ${actionTrigger.classList.contains('is-on') ? 'enabled' : 'disabled'} for this session.`, 'success'); },
    'wallet-pin': showWalletPin,
    'parcel-category': () => { state.parcelCategory = value; renderCurrentScreen(); },
    'parcel-back': () => { state.parcelStep = Math.max(1, state.parcelStep - 1); renderCurrentScreen(); },
    'parcel-next': advanceParcel,
    'parcel-payment-state': () => { state.parcelPaymentDemoState = value; renderCurrentScreen(); },
    'parcel-payment-reset': () => { state.parcelPaymentDemoState = 'idle'; renderCurrentScreen(); },
    'upload-demo': () => toast('Attachment placeholder selected. No file was uploaded.', 'success'),
    'track-parcel': loadTracking,
    'tracking-state': () => { state.parcelTrackingState = value; renderCurrentScreen(); },
    'open-single-tracking': () => {
      state.trackingView = 'single';
      state.selectedTrackingId = value || (actionTrigger.dataset && actionTrigger.dataset.id);
      renderCurrentScreen();
    },
    'back-to-tracking-hub': () => {
      state.trackingView = 'hub';
      state.selectedTrackingId = null;
      renderCurrentScreen();
    },
    'chat-driver': () => {
      navigate('driver-chat');
    },
    'call-driver': () => {
      navigate('driver-call');
    },
    'review-call-driver': () => {
      const driverKey = value || (state.activeTrip ? state.activeTrip.driverName.toLowerCase() : 'moses mukasa');
      state.viewingDriverName = driverKey;
      navigate('driver-call');
    },
    'review-chat-driver': () => {
      const driverKey = value || (state.activeTrip ? state.activeTrip.driverName.toLowerCase() : 'moses mukasa');
      state.viewingDriverName = driverKey;
      navigate('driver-chat');
    },
    'send-chat-demo': () => {
      const input = document.querySelector('.chat-compose-input');
      if (input && input.value.trim()) {
        const dKey = state.viewingDriverName || 'isaac muwonge';
        const driver = driversData[dKey] || driversData['isaac muwonge'];
        if (driver && driver.status === 'driving') {
          toast(`Message sent! ${driver.name} is on the road and will read it upon reaching their destination.`, 'info');
        } else {
          toast('Message sent successfully.', 'success');
        }
        input.value = '';
      } else {
        toast('Type a message first.', 'warning');
      }
    },
    'end-call-demo': () => {
      toast('Call ended.', 'info');
      goBack();
    },
    'back-from-chat': () => {
      goBack();
    },
    'modal-chat-driver': () => {
      closeModal();
      state.viewingDriverName = value;
      const driver = driversData[value] || driversData['isaac muwonge'];
      if (driver.status === 'driving') {
        toast(`For safety, ${driver.name} cannot receive messages while driving. Please call instead.`, 'warning');
      } else {
        navigate('driver-chat');
      }
    },
    'modal-call-driver': () => {
      closeModal();
      state.viewingDriverName = value;
      navigate('driver-call');
    },
    'toggle-mute-demo': () => {
      const btn = actionTrigger.closest('.call-action-btn');
      if (btn) btn.classList.toggle('is-active');
      toast(btn?.classList.contains('is-active') ? 'Microphone muted.' : 'Microphone unmuted.', 'info');
    },
    'toggle-speaker-demo': () => {
      const btn = actionTrigger.closest('.call-action-btn');
      if (btn) btn.classList.toggle('is-active');
      toast(btn?.classList.contains('is-active') ? 'Speaker on.' : 'Speaker off.', 'info');
    },
    'edit-parcel-title': () => toast('Edit title feature is a prototype concept.', 'success'),
    'receiving-another': () => toast('Receiving by another person form opened.', 'success'),
    'invalid-tracking': showInvalidTracking,
    'offer-details': showOfferDetails,
    'sponsored-details': showSponsoredDetails,
    'mark-all-read': markAllRead,
    'notification-filter': () => { state.notificationFilter = value; renderCurrentScreen(); },
    'notification-detail': () => showNotificationDetail(Number(actionTrigger.dataset.id)),
    'notification-preferences': showNotificationPreferences,
    'faq-toggle': () => actionTrigger.closest('.faq-item')?.classList.toggle('is-open'),
    'call-support': () => showCallSupport(),
    'chat-support': () => showChatSupport(),
    'support-category': () => selectSupportCategory(value),
    'submit-support': () => { state.supportSubmitted = true; renderCurrentScreen(); toast('Support request SUP-44720 submitted.', 'success'); },
    'new-support': () => { state.supportSubmitted = false; renderCurrentScreen(); },
    'support-statuses': showSupportStatuses,
    'edit-profile': showEditProfile,
    'saved-passengers': showSavedPassengers,
    'saved-pickups': showSavedPickups,
    'language': showLanguageModal,
    'privacy': showPrivacy,
    'terms': showTerms,
    'accessibility': () => toggleAccessibility(value),
    'open-demo-panel': openDemoPanel,
    'sign-out': () => { closeSideDrawer(); signOut(); },
    'close-modal': closeModal,
    'close-sheet': closeSheet,
    'demo-state': () => triggerDemoState(value),
    'amount-preset': () => selectAmountPreset(actionTrigger),
    'deposit-state': () => showDepositState(value),
    'save-profile': () => {
      const nameInput = document.getElementById('edit-profile-name');
      const phoneInput = document.getElementById('edit-profile-phone');
      const emailInput = document.getElementById('edit-profile-email');
      const emergencyInput = document.getElementById('edit-profile-emergency');
      const avatarInput = document.getElementById('edit-avatar-url');

      if (nameInput && nameInput.value.trim()) state.userName = nameInput.value.trim();
      if (phoneInput && phoneInput.value.trim()) state.userPhone = phoneInput.value.trim();
      if (emailInput && emailInput.value.trim()) state.userEmail = emailInput.value.trim();
      if (emergencyInput && emergencyInput.value.trim()) state.emergencyContact = emergencyInput.value.trim();
      if (avatarInput && avatarInput.value) state.userAvatar = avatarInput.value;

      closeModal();
      renderCurrentScreen();
      toast('Profile details and photo updated successfully!', 'success');
    },
    'save-language': () => saveLanguage(),
    'save-preferences': () => { closeModal(); toast('Notification preferences updated for this session.', 'success'); },
    'send-wallet-demo': () => { closeModal(); toast('Demo transfer prepared. No funds were moved.', 'success'); },
    'set-wallet-pin': () => { closeModal(); toast('Wallet PIN updated for this session.', 'success'); },
    'confirm-cancel': () => { closeModal(); state.ticketStatus = 'cancelled'; state.tripTab = 'cancelled'; navigate('trips'); toast('Booking moved to the Cancelled preview state.', 'warning'); },
    'save-return-date': () => saveReturnDate(),
    'submit-rating': () => { closeModal(); toast('Thank you. Your demonstration rating was recorded.', 'success'); },
    'submit-lost-item': () => { closeModal(); toast('Lost-property report LP-1842 submitted.', 'success'); },
    'select-hire-vehicle': () => {
      state.specialHire.vehicleType = value;
      state.specialHire.vehicleId = value;
      renderCurrentScreen();
    },
    'select-hire-dest-type': () => {
      state.specialHire.destinationType = value;
      renderCurrentScreen();
    },
    'decrement-hire-days': () => {
      state.specialHire.durationDays = Math.max(1, (Number(state.specialHire.durationDays) || 1) - 1);
      renderCurrentScreen();
    },
    'increment-hire-days': () => {
      state.specialHire.durationDays = Math.min(30, (Number(state.specialHire.durationDays) || 1) + 1);
      renderCurrentScreen();
    },
    'select-hire-driver': () => {
      state.specialHire.driverType = value;
      renderCurrentScreen();
    },
    'select-hire-user-type': () => {
      state.specialHire.hireType = value;
      renderCurrentScreen();
    },
    'select-hire-payment-method': () => {
      state.specialHire.paymentMethod = value;
      state.specialHire.paymentDemoState = 'idle';
      renderCurrentScreen();
    },
    'hire-payment-state': () => {
      state.specialHire.paymentDemoState = value;
      renderCurrentScreen();
    },
    'hire-payment-reset': () => {
      state.specialHire.paymentDemoState = 'idle';
      renderCurrentScreen();
    },
    'special-hire-next': () => {
      const sh = state.specialHire;
      if (sh.step === 1) {
        if (sh.destinationType === 'custom' && (!sh.customDestination || !sh.customDestination.trim())) {
          toast('Please enter a destination in Uganda.', 'warning');
          return;
        }
      }
      sh.step = Math.min(4, sh.step + 1);
      renderCurrentScreen();
    },
    'special-hire-back': () => {
      state.specialHire.step = Math.max(1, state.specialHire.step - 1);
      renderCurrentScreen();
    },
    'confirm-hire-payment': () => {
      const priceDetails = calculateSpecialHirePrice();
      const method = state.specialHire.paymentMethod;
      if (method === 'wallet') {
        if (state.walletBalance < priceDetails.total) {
          toast('Insufficient wallet balance. Please add funds first.', 'danger');
          return;
        }
        state.walletBalance -= priceDetails.total;
        appData.transactions.unshift({
          type: 'booking',
          title: 'Special Vehicle Hire',
          date: 'Today, ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          amount: priceDetails.total,
          direction: 'out',
          icon: 'bus'
        });
      }
      if (method === 'mobile' || method === 'mtn' || method === 'airtel') {
        if (state.specialHire.paymentDemoState !== 'success') {
          toast('Simulate a successful mobile-money response before confirming.', 'danger');
          return;
        }
      }
      state.specialHire.step = 4;
      renderCurrentScreen();
      toast('Private Charter booking reserved successfully!', 'success');
    },
    'print-permit': () => toast('Print receipt request sent to network printer.', 'success'),
    'copy-code': () => toast('Verification code copied in the mockup.', 'success')
  };

  if (actions[action]) actions[action]();
}

function handleChange(event) {
  const target = event.target;
  const bookingFields = {
    'search-from': value => { state.searchFrom = value; state.dropOffLocation = state.searchTo; renderCurrentScreen(); },
    'search-to': value => { state.searchTo = value; state.dropOffLocation = value; renderCurrentScreen(); },
    'booking-date': value => { state.bookingDate = value; },
    'search-period': value => { state.searchPeriod = value; },
    'search-adults': value => { state.passengerCount = Number(value) || 1; },
    'search-children': value => { state.childCount = Number(value) || 0; },
    'drop-off-location': value => { state.dropOffLocation = value; if (value !== '__other__') state.customDropOff = ''; renderCurrentScreen(); },
    'custom-drop-off': value => { state.customDropOff = value; }
  };
  bookingFields[target.dataset.field]?.(target.value);
  if (target.dataset.field === 'return-date') {
    state.returnDate = target.value;
  }
  if (target.name === 'payment-method') {
    state.paymentMethod = target.value;
    state.paymentDemoState = 'idle';
    renderCurrentScreen();
  }
  if (target.name === 'hire-payment-method') {
    state.specialHire.paymentMethod = target.value;
    state.specialHire.paymentDemoState = 'idle';
    renderCurrentScreen();
  }
  if (target.name === 'parcel-delivery') {
    state.parcelDelivery = target.value;
    renderCurrentScreen();
  }
  if (target.name === 'parcel-payment-method') {
    state.parcelPaymentMethod = target.value;
    state.parcelPaymentDemoState = 'idle';
    renderCurrentScreen();
  }
  if (target.dataset.parcelField) state.parcel[target.dataset.parcelField] = target.value;
  if (target.dataset.passengerField) {
    const index = Number(target.dataset.passengerIndex);
    if (state.passengerDetails[index]) state.passengerDetails[index][target.dataset.passengerField] = target.value;
    if (index === 0 && target.dataset.passengerField === 'assistance') state.assistance = target.value;
  }
  if (target.dataset.hireField) {
    state.specialHire[target.dataset.hireField] = target.value;
    if (target.dataset.hireField === 'durationDays') {
      state.specialHire.durationDays = Math.max(1, Number(target.value) || 1);
    }
    renderCurrentScreen();
  }
}

function handleInput(event) {
  const target = event.target;
  if (target.dataset.parcelField) state.parcel[target.dataset.parcelField] = target.value;
  if (target.dataset.field === 'other-traveler-name') {
    state.otherTravelerName = target.value;
    if (state.passengerDetails[0]) {
      state.passengerDetails[0].name = target.value;
    }
  }
  if (target.dataset.field === 'other-traveler-phone') {
    state.otherTravelerPhone = target.value;
    if (state.passengerDetails[0]) {
      state.passengerDetails[0].phone = target.value;
    }
  }
  if (target.dataset.passengerField) {
    const index = Number(target.dataset.passengerIndex);
    if (state.passengerDetails[index]) state.passengerDetails[index][target.dataset.passengerField] = target.value;
  }
  if (target.dataset.hireField) {
    state.specialHire[target.dataset.hireField] = target.value;
  }
  if (target.classList.contains('otp-input') && target.value.length === 1) {
    const fields = $$('.otp-input');
    const index = fields.indexOf(target);
    if (index < fields.length - 1) fields[index + 1].focus();
  }
}

function handleKeydown(event) {
  const activeDialog = $('#modal-root [role="dialog"]') || $('#sheet-root [role="dialog"]') || $('#side-drawer:not(.is-hidden)');
  if (event.key === 'Tab' && activeDialog) {
    const focusable = $$('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])', activeDialog).filter(element => element.getClientRects().length && !element.closest('[inert]'));
    if (!focusable.length) { event.preventDefault(); activeDialog.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  if (event.key === 'Escape') {
    if ($('#modal-root [role="dialog"]')) closeModal();
    else if ($('#sheet-root [role="dialog"]')) closeSheet();
    else if ($('#side-drawer:not(.is-hidden)')) closeSideDrawer();
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][data-screen], [role="button"][data-action]')) {
    event.preventDefault(); event.target.click();
  }
}

function verifyOtp() {
  const code = $$('.otp-input').map(input => input.value).join('');
  if (code === '1234') showLoading('Verifying demonstration code…', () => enterApp('Sign-in preview verified successfully.'));
  else toast('Use the demonstration code 1234.', 'danger');
}

function swapRoute() {
  if (state.selectedRoute === 'busega') {
    toast('The Entebbe-Kampala (Via Busega) route runs one-way only. The reverse direction is not supported.', 'warning');
    return;
  }
  const temp = state.searchFrom;
  state.searchFrom = state.searchTo;
  state.searchTo = temp;
  const route = state.selectedRoute || 'entebbe';
  state.routeFlips[route] = !state.routeFlips[route];
  renderCurrentScreen();
  toast('Route direction swapped.', 'success');
}

function saveReturnDate() {
  const value = $('#return-date-modal')?.value;
  if (!value || value < state.bookingDate) {
    toast('Choose a return date on or after the outbound trip.', 'danger');
    return;
  }
  state.returnDate = value;
  state.ticketType = 'return';
  state.tripType = 'return';
  state.returnMode = 'date-specific';
  closeModal();
  renderCurrentScreen(false);
  toast(`Return date updated to ${formatDemoDate(value)}.`, 'success');
}

function toggleSeat(seat) {
  if (!seat) return;
  if (state.selectedSeats.includes(seat)) state.selectedSeats = state.selectedSeats.filter(value => value !== seat);
  else if (state.selectedSeats.length < state.passengerCount + state.childCount) state.selectedSeats.push(seat);
  else toast('The selected seat count already matches the passenger count.', 'warning');
  renderCurrentScreen();
}

function updateLuggage(id, delta) {
  state.luggageQuantities[id] = Math.max(0, Math.min(5, (state.luggageQuantities[id] || 0) + delta));
  renderCurrentScreen();
}

function noAdditionalLuggage() {
  Object.keys(state.luggageQuantities).forEach(key => state.luggageQuantities[key] = 0);
  state.luggageQuantities.personal = 1;
  renderCurrentScreen();
  toast('Only the free personal item remains selected.', 'success');
}

function applyVoucher() {
  const code = $('#voucher-code')?.value.trim().toUpperCase();
  if (code !== 'TAXIBEE2000') {
    toast('Use the demonstration voucher TAXIBEE2000.', 'danger');
    return;
  }
  state.voucherApplied = true;
  state.paymentMethod = 'wallet';
  state.paymentDemoState = 'idle';
  renderCurrentScreen();
  toast('UGX 2,000 voucher applied. Choose how to pay the balance.', 'success');
}

function openLuggageConfigModal() {
  const modalBody = `
    <p class="muted" style="margin-bottom: 16px;">Specify the count of bags or items you wish to declare for this trip.</p>
    <div class="settings-list" style="display: flex; flex-direction: column; gap: 12px;">
      ${appData.luggage.map(item => `
        <div class="settings-row" style="padding: 12px 0; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="luggage-modal-icon" style="width: 36px; height: 36px; background: rgba(26,26,26, 0.08); color: var(--brand-blue); border-radius: 8px; display: grid; place-items: center; flex-shrink: 0;"><i data-lucide="${item.icon}" style="width: 18px; height: 18px;"></i></div>
            <div style="text-align: left;">
              <strong style="display: block; font-size: 0.9rem;">${item.name}</strong>
              <span class="muted text-small" style="display: block; font-size: 0.75rem;">${item.desc}</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <span style="font-weight: 700; color: var(--brand-blue); font-size: 0.9rem;">${item.price === 0 ? 'Free' : formatUGX(item.price)}</span>
            <div style="display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 2px; background: white;">
              <button class="icon-button icon-button--plain" style="width:28px;height:28px; border:0; background:transparent; font-size: 1.1rem; cursor:pointer;" type="button" data-action="modal-luggage-minus" data-id="${item.id}">−</button>
              <span style="min-width:18px; text-align:center; font-weight:700;">${state.luggageQuantities[item.id] || 0}</span>
              <button class="icon-button icon-button--plain" style="width:28px;height:28px; border:0; background:transparent; font-size: 1.1rem; cursor:pointer;" type="button" data-action="modal-luggage-plus" data-id="${item.id}">+</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  const modalFooter = `
    <button class="button button--primary w-full" type="button" data-action="close-modal">Save Luggage Registration</button>
  `;
  openModal('Declare luggage items', modalBody, modalFooter);
}

function confirmBooking() {
  const accepted = $('#booking-conditions')?.checked;
  if (!accepted) { toast('Accept the booking conditions to continue.', 'danger'); return; }
  if (passengerTotal() > state.activeTrip.seats) { toast(`Only ${state.activeTrip.seats} passenger spaces remain on this departure. Choose another trip or reduce the group.`, 'danger'); return; }
  if (state.ticketType === 'return' && state.returnMode === 'date-specific' && state.returnDate < state.bookingDate) { toast('Choose a return date on or after the outbound trip.', 'danger'); return; }
  if (state.capacityMode === 'seats' && state.selectedSeats.length !== passengerTotal()) { toast(`Choose ${passengerTotal()} seat${passengerTotal() === 1 ? '' : 's'}, or use best available.`, 'danger'); return; }
  if (state.paymentMethod === 'wallet') {
    const pin = $('#wallet-pin')?.value.trim() || '';
    if (!/^\d{4}$/.test(pin)) { toast('Enter any four digits for the demonstration wallet PIN.', 'danger'); return; }
    if (checkoutTotal() > state.walletBalance) { toast('The demonstration wallet balance is insufficient. Choose another payment method.', 'danger'); return; }
  }
  if (state.paymentMethod === 'mobile') {
    if (state.paymentDemoState === 'idle') { toast('Simulate a mobile-money response before confirming.', 'danger'); return; }
    if (state.paymentDemoState === 'failed') { toast('The simulated authorization failed. Reset it or choose another payment method.', 'danger'); return; }
  }
  if (state.paymentMethod === 'corporate' && ($('#corporate-reference')?.value.trim().length || 0) < 4) { toast('Enter a valid corporate account reference.', 'danger'); return; }
  state.ticketStatus = 'active';
  const newTicketId = `TK-${Math.floor(100000 + Math.random() * 900000)}`;
  const trip = state.activeTrip || {};
  getTicketsData().unshift({
    id: newTicketId,
    route: `${state.searchFrom || 'Entebbe Bus Park'} → ${state.searchTo || 'Kampala Railway Stage'}`,
    cityA: state.searchFrom || 'Entebbe',
    cityB: state.searchTo || 'Kampala',
    stageA: state.searchFrom || 'Entebbe Bus Park',
    stageB: state.searchTo || 'Kampala Railway Stage',
    via: trip.via || 'Via Expressway',
    date: 'Today, 25 Jul 2026',
    time: trip.depart || '10:00 AM',
    seat: state.selectedSeats.length > 0 ? `Seat ${state.selectedSeats.map(s => String(s).padStart(2, '0')).join(', ')}` : 'Seat 01',
    passenger: state.contactName || 'Christo I.',
    price: formatUGX(checkoutTotal()),
    status: 'active',
    vanNumber: trip.plate || 'UBA 412X',
    driver: trip.driverName || 'David Ssemwanga',
    avatar: 'assets/driver_1-branded.png',
    qrData: `TAXIBEE|${newTicketId}|CHRISTO`
  });
  showLoading('Creating demonstration booking…', () => { navigate('success'); toast('Your trip is reserved in the prototype.', 'success'); });
}

function loadTracking() {
  const value = $('#tracking-number')?.value.trim().toUpperCase();
  if (value) {
    if (value !== '964201832-DL' && value !== '#964201832-DL' && value !== 'FXP-260718-0842') {
      showInvalidTracking();
      return;
    }
    showLoading('Loading tracking details…', () => {
      state.parcelTrackingState = 'intransit';
      state.trackingView = 'single';
      state.selectedTrackingId = value.startsWith('#') ? value : `#${value}`;
      navigate('tracking');
      toast('Tracking loaded.', 'success');
    });
  } else {
    navigate('tracking');
  }
}

function markAllRead() {
  appData.notifications.forEach(item => item.unread = false);
  state.unreadNotifications = 0;
  renderNavigation(); renderCurrentScreen();
  $('#notification-badge').textContent = '0';
  $('#notification-badge').classList.add('is-hidden');
  toast('All notifications marked as read.', 'success');
}

function selectSupportCategory(category) {
  const select = $('#support-category');
  if (select) select.value = category;
  toast(`${category} selected. Complete the support form.`, 'success');
  window.scrollTo({ top: 250, behavior: 'smooth' });
}

function toggleAccessibility(className) {
  document.body.classList.toggle(className);
  renderCurrentScreen();
  toast(`${className.replace('-', ' ')} ${document.body.classList.contains(className) ? 'enabled' : 'disabled'}.`, 'success');
}

function toggleConnection() {
  state.connected = !state.connected;
  document.body.classList.toggle('offline', !state.connected);
  $$('.connection-label').forEach(el => el.textContent = state.connected ? 'Online' : 'Offline');
  toast(state.connected ? 'Connection restored — demonstration state.' : 'No internet — demonstration state.', state.connected ? 'success' : 'warning');
}

function simulateNavigation(message, screen) {
  showLoading(message, () => navigate(screen));
}

function showLoading(message, callback, duration = 750) {
  $('#loading-message').textContent = message;
  $('#loading-overlay').classList.remove('is-hidden');
  refreshIcons();
  setTimeout(() => {
    $('#loading-overlay').classList.add('is-hidden');
    if (callback) callback();
  }, duration);
}

function toast(message, type = 'default') {
  // Only allow key transactional, error, warning, or state change notifications
  if (type === 'default' || type === 'success' || type === 'info') {
    const lower = message.toLowerCase();
    const isKeyAction = 
      lower.includes('save') || 
      lower.includes('update') || 
      lower.includes('submit') || 
      lower.includes('ready') || 
      lower.includes('claim') || 
      lower.includes('add') || 
      lower.includes('process') || 
      lower.includes('cancel') || 
      lower.includes('transfer') || 
      lower.includes('refund') || 
      lower.includes('sent') || 
      lower.includes('prepare') || 
      lower.includes('register') ||
      lower.includes('insufficient') ||
      lower.includes('invalid') ||
      lower.includes('otp');
      
    if (!isKeyAction) {
      console.log(`Silenced non-essential toast: ${message}`);
      return;
    }
  }

  const region = $('#toast-region');
  const icon = type === 'success' ? 'circle-check' : type === 'danger' ? 'circle-x' : type === 'warning' ? 'triangle-alert' : 'info';
  const element = document.createElement('div');
  element.className = `toast toast--${type}`;
  element.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>`;
  region.appendChild(element);
  refreshIcons();
  setTimeout(() => element.remove(), 3600);
}

/* =========================================================
   Modals and bottom sheets
   ========================================================= */

let modalOpener = null;
let sheetOpener = null;
let sideDrawerOpener = null;

function updateBackgroundInert() {
  const sideOpen = document.documentElement.classList.contains('taxibee-customer-chrome')
    && document.body.classList.contains('drawer-open');
  const active = Boolean($('#modal-root [role="dialog"]') || $('#sheet-root [role="dialog"]') || sideOpen);
  const shell = $('#app-shell');
  if (shell) {
    if (active) shell.setAttribute('inert', '');
    else shell.removeAttribute('inert');
  }
  $('#mobile-nav')?.toggleAttribute('inert', sideOpen);
}

function openModal(title, body, footer = '', wide = false, customClass = '') {
  if (!$('#modal-root [role="dialog"]')) modalOpener = document.activeElement;
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal ${wide ? 'modal--wide' : ''} ${customClass}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal__head">
          <div>
            <span class="modal__eyebrow"><i data-lucide="sparkles"></i> Taxibee</span>
            <h2 id="modal-title">${title}</h2>
          </div>
          <button class="modal__close-btn" type="button" data-action="close-modal" aria-label="Close dialog">
            <i data-lucide="x"></i>
          </button>
        </header>
        <div class="modal__body">${body}</div>
        ${footer ? `<footer class="modal__foot">${footer}</footer>` : ''}
      </section>
    </div>
  `;
  updateBackgroundInert();
  refreshIcons();
  setTimeout(() => $('.modal button, .modal input, .modal select')?.focus(), 20);
}

function closeModal() {
  const hadModal = Boolean($('#modal-root [role="dialog"]'));
  $('#modal-root').innerHTML = '';
  updateBackgroundInert();
  if (hadModal && modalOpener?.isConnected) modalOpener.focus({ preventScroll: true });
  modalOpener = null;
}
function closeSheet() {
  const hadSheet = Boolean($('#sheet-root [role="dialog"]'));
  $('#sheet-root').innerHTML = '';
  updateBackgroundInert();
  if (hadSheet && sheetOpener?.isConnected) sheetOpener.focus({ preventScroll: true });
  sheetOpener = null;
}

function openSideDrawer() {
  const drawer = $('#side-drawer');
  if (!drawer) return;
  const isOpen = !drawer.classList.contains('is-hidden');
  if (isOpen) {
    closeSideDrawer();
  } else {
    sideDrawerOpener = document.activeElement;
    drawer.classList.remove('is-hidden');
    drawer.inert = false;
    document.body.classList.add('drawer-open');
    $$('[aria-controls="side-drawer"]').forEach(button => button.setAttribute('aria-expanded', 'true'));
    updateBackgroundInert();
    refreshIcons();
    $('[data-action="close-drawer"]', drawer)?.focus({ preventScroll: true });
  }
}
function closeSideDrawer() {
  const drawer = $('#side-drawer');
  if (!drawer || drawer.classList.contains('is-hidden')) return;
  drawer.classList.add('is-hidden');
  drawer.inert = true;
  document.body.classList.remove('drawer-open');
  $$('[aria-controls="side-drawer"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  updateBackgroundInert();
  if (sideDrawerOpener?.isConnected) sideDrawerOpener.focus({ preventScroll: true });
  sideDrawerOpener = null;
}

function openMoreSheet() {
  const extra = navItems.filter(([screen]) => !['home','book','trips','wallet'].includes(screen));
  sheetOpener = document.activeElement;
  $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"><section class="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="more-sheet-title" tabindex="-1"><div class="bottom-sheet__grabber"></div><div class="card-head"><div><p class="section-kicker">More services</p><h2 id="more-sheet-title">Taxibee Passenger App</h2></div><button class="icon-button icon-button--plain" type="button" data-action="close-sheet" aria-label="Close services menu"><i data-lucide="x"></i></button></div><div class="grid grid--2">${extra.map(([screen,label,icon]) => `<button class="card card--compact card--hover" style="text-align:left;cursor:pointer" type="button" data-screen="${screen}"><span class="quick-action__icon"><i data-lucide="${icon}"></i></span><strong style="display:block;margin-top:9px">${label}</strong></button>`).join('')}</div></section></div>`;
  updateBackgroundInert();
  refreshIcons();
  setTimeout(() => $('#sheet-root button[data-action="close-sheet"]')?.focus(), 20);
}

function showSearchFilters() {
  openModal('Search filters', `<div class="form-grid"><div class="field"><label>Approximate travel time</label><select><option>Any duration</option><option>Up to 60 minutes</option><option>Up to 90 minutes</option></select></div><div class="field"><label>Vehicle type</label><select><option>All vehicles</option><option>Commuter (14)</option><option>Highroof (18)</option></select></div><div class="field"><label>Capacity</label><select><option>Any availability</option><option>5+ spaces</option><option>10+ spaces</option></select></div><div class="field"><label>Traffic condition</label><select><option>All conditions</option><option>Light</option><option>Moderate</option></select></div></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="apply-filters">Apply Filters</button>`);
}

function showShareModal(title = 'Share ticket') {
  openModal(title, `<p class="muted">Choose a visual sharing destination. Nothing will leave this browser.</p><div class="grid grid--2"><button class="card card--compact card--hover" type="button" data-action="close-modal"><i data-lucide="message-circle"></i><strong style="display:block;margin-top:8px">WhatsApp preview</strong></button><button class="card card--compact card--hover" type="button" data-action="close-modal"><i data-lucide="mail"></i><strong style="display:block;margin-top:8px">Email preview</strong></button><button class="card card--compact card--hover" type="button" data-action="copy-code"><i data-lucide="copy"></i><strong style="display:block;margin-top:8px">Copy reference</strong></button><button class="card card--compact card--hover" type="button" data-action="close-modal"><i data-lucide="share-2"></i><strong style="display:block;margin-top:8px">More options</strong></button></div>`);
}

function showTicketStates() {
  const states = [['Active','status-chip--success'],['Used','status-chip--info'],['Expired','status-chip--warning'],['Cancelled','status-chip--danger'],['Payment Pending','status-chip--warning']];
  openModal('Ticket state preview', `<p class="muted">Review how the passenger ticket communicates each lifecycle state without relying on color alone.</p><div class="grid">${states.map(([label,cls]) => `<button class="card card--compact card--hover" type="button" data-action="demo-state" data-value="ticket-${label.toLowerCase().replaceAll(' ','-')}"><span class="status-chip ${cls}">${label}</span><strong style="display:block;margin-top:9px">${label} ticket</strong><span class="muted text-small">Trigger the ${label.toLowerCase()} ticket demonstration.</span></button>`).join('')}</div>`);
}

function showCancelBooking() {
  openModal('Cancel booking?', `<div class="notice"><i data-lucide="triangle-alert"></i><div><strong>This changes only the prototype state.</strong><div>No real booking or refund will be created.</div></div></div><div class="field" style="margin-top:15px"><label>Cancellation reason</label><select><option>Change of travel plans</option><option>Booked wrong time</option><option>Prefer another departure</option></select></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Keep Booking</button><button class="button button--soft-red" type="button" data-action="confirm-cancel">Cancel Demo Booking</button>`);
}

function showReturnDateModal() {
  openModal('Change return date', `<div class="field"><label for="return-date-modal">New return date</label><input id="return-date-modal" type="date" min="${state.bookingDate}" value="${state.returnDate}"></div><div class="field" style="margin-top:12px"><label for="return-period-modal">Preferred period</label><select id="return-period-modal"><option>Morning</option><option>Afternoon</option><option>Evening</option></select></div><div class="notice" style="margin-top:14px"><i data-lucide="info"></i><div>Open return availability remains subject to eligible departures.</div></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="save-return-date">Save Date</button>`);
}

function showRatingModal() {
  openModal('Rate your travel', `<p class="muted">How was your completed journey?</p><div class="choice-pills">${[1,2,3,4,5].map(n => `<button class="choice-pill ${n === 5 ? 'is-selected' : ''}\" type="button">${n} / 5</button>`).join('')}</div><div class="field" style="margin-top:14px"><label>Feedback</label><textarea>The vehicle departed on time and the crew was professional.</textarea></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="submit-rating">Submit Rating</button>`);
}

function openLostPropertyModal() {
  openModal('Report lost property', `<div class="form-grid"><div class="field"><label>Related travel</label><select><option>16 Jul · Kampala → Entebbe</option></select></div><div class="field"><label>Item category</label><select><option>Bag</option><option>Phone</option><option>Documents</option><option>Clothing</option></select></div><div class="field field--full"><label>Item description</label><textarea>Black notebook left near the rear seat.</textarea></div><div class="field field--full"><label>Contact number</label><input value="+256 772 345 678"></div></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="submit-lost-item">Submit Report</button>`);
}

function showEmergencyModal() {
  openModal('Emergency and safety contact', `<div class="payment-state"><div class="payment-state__icon payment-state__icon--failed"><i data-lucide="siren"></i></div><h3>Taxibee emergency assistance</h3><p class="muted">In a production app this would offer verified emergency calling and travel context. This prototype does not place calls.</p></div><div class="detail-list"><div class="detail-row"><span>Vehicle</span><strong>${state.activeTrip.plate}</strong></div><div class="detail-row"><span>Route</span><strong>${state.activeTrip.boarding} → ${state.activeTrip.destination}</strong></div><div class="detail-row"><span>Demonstration number</span><strong>+256 700 000 099</strong></div></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Close</button><button class="button button--soft-red" type="button" data-action="close-modal">Call Preview</button>`);
}

function openAddFunds() {
  openModal('Add wallet funds', `<div class="notice"><i data-lucide="info"></i><div>This preview does not process or store real money.</div></div><div class="field" style="margin-top:14px"><label for="wallet-funding-method">Funding method</label><select id="wallet-funding-method"><option>MTN Mobile Money</option><option>Airtel Money</option><option>Voucher</option><option>Stage Agent</option></select></div><p class="field-label" style="margin-top:14px">Choose amount</p><div class="amount-presets">${[5000,10000,20000,50000,100000].map(amount => `<button class="amount-preset ${state.walletDepositAmount === amount ? 'is-selected' : ''}" type="button" data-action="amount-preset" data-amount="${amount}" aria-pressed="${state.walletDepositAmount === amount}">${formatUGX(amount)}</button>`).join('')}<button class="amount-preset" type="button" data-action="amount-preset" data-amount="custom" aria-pressed="false">Custom</button></div><div class="field"><label for="wallet-custom-amount">Custom amount</label><input id="wallet-custom-amount" inputmode="numeric" value="${state.walletDepositAmount}"></div><div class="button-row" style="margin-top:15px"><button class="button button--secondary button--small" type="button" data-action="deposit-state" data-value="pending">Pending</button><button class="button button--success button--small" type="button" data-action="deposit-state" data-value="success">Success</button><button class="button button--soft-red button--small" type="button" data-action="deposit-state" data-value="failed">Failure</button></div>`, '', true);
}

function selectAmountPreset(button) {
  const amount = button.dataset.amount === 'custom' ? Number(String($('#wallet-custom-amount')?.value || '').replace(/\D/g, '')) : Number(button.dataset.amount);
  if (Number.isFinite(amount) && amount > 0) state.walletDepositAmount = amount;
  $$('.amount-preset').forEach(item => { item.classList.remove('is-selected'); item.setAttribute('aria-pressed', 'false'); });
  button.classList.add('is-selected');
  button.setAttribute('aria-pressed', 'true');
  const custom = $('#wallet-custom-amount');
  if (custom && button.dataset.amount !== 'custom') custom.value = state.walletDepositAmount;
}

function showDepositState(type) {
  const custom = Number(String($('#wallet-custom-amount')?.value || '').replace(/\D/g, ''));
  if (custom > 0) state.walletDepositAmount = custom;
  const title = type === 'pending' ? 'Deposit pending' : type === 'success' ? 'Wallet deposit successful' : 'Wallet deposit failed';
  const copy = type === 'pending' ? `The simulated ${formatUGX(state.walletDepositAmount)} authorization is awaiting approval.` : type === 'success' ? `${formatUGX(state.walletDepositAmount)} was added to the demonstration wallet.` : 'The simulated authorization was declined.';
  if (type === 'success') state.walletBalance += state.walletDepositAmount;
  openModal(title, `<div class="payment-state"><div class="payment-state__icon payment-state__icon--${type}"><i data-lucide="${type === 'pending' ? 'loader-circle' : type === 'success' ? 'circle-check-big' : 'circle-x'}"></i></div><h3>${title}</h3><p class="muted">${copy}</p><p class="privacy-note">All balances reset when the page refreshes.</p></div>`, `<button class="button button--primary" type="button" data-action="close-modal">Done</button>`);
  if (type === 'success') toast('Wallet deposit successful — demonstration state.', 'success');
}

function showSendPassenger() {
  openModal('Send to another passenger', `<div class="form-grid"><div class="field field--full"><label>Passenger telephone number</label><input value="+256 700 555 018"></div><div class="field field--full"><label>Amount</label><input value="UGX 5,000"></div><div class="field field--full"><label>Wallet PIN</label><input type="password" value="2580"></div></div><div class="notice" style="margin-top:14px"><i data-lucide="info"></i><div>No funds will move. This is a visual workflow only.</div></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="send-wallet-demo">Continue</button>`);
}

function showWalletPin() {
  openModal('Wallet PIN settings', `<div class="field"><label>Current PIN</label><input type="password" value="2580"></div><div class="field" style="margin-top:12px"><label>New four-digit PIN</label><input type="password" value="4829"></div><div class="field" style="margin-top:12px"><label>Confirm new PIN</label><input type="password" value="4829"></div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="set-wallet-pin">Update PIN</button>`);
}

function showInvalidTracking() {
  openModal('No parcel found', `<div class="payment-state"><div class="payment-state__icon payment-state__icon--failed"><i data-lucide="package-x"></i></div><h3>Tracking number not recognized</h3><p class="muted">Check the number and try <strong>964201832-DL</strong> for the demonstration result.</p></div>`, `<button class="button button--primary" type="button" data-action="close-modal">Try Again</button>`);
}

function showOfferDetails() {
  openModal('Offer conditions', `<div class="detail-list"><div class="detail-row"><span>Eligibility</span><strong>Selected passenger accounts</strong></div><div class="detail-row"><span>Validity</span><strong>Presentation period only</strong></div><div class="detail-row"><span>Redemption</span><strong>Automatic at checkout preview</strong></div></div><div class="notice" style="margin-top:14px"><i data-lucide="badge-info"></i><div>All offers are fictional demonstration content and have no monetary value.</div></div>`);
}

function showSponsoredDetails() {
  openModal('Sponsored advertisement', `<span class="sponsored-label" style="background:var(--charcoal);color:white">Sponsored</span><h3 style="margin-top:14px">Fictional local business advertisement</h3><p class="muted">This area demonstrates how Taxibee could present approved advertiser content without confusing it with transport operations.</p><div class="detail-list"><div class="detail-row"><span>Advertiser</span><strong>Demonstration partner</strong></div><div class="detail-row"><span>Placement</span><strong>Passenger offers</strong></div><div class="detail-row"><span>External action</span><strong>Disabled in prototype</strong></div></div>`);
}

function showNotificationDetail(id) {
  const item = appData.notifications.find(n => n.id === id);
  if (!item) return;
  if (item.unread) {
    item.unread = false;
    state.unreadNotifications = Math.max(0, state.unreadNotifications - 1);
    renderNavigation();
    const row = $(`[data-action="notification-detail"][data-id="${id}"]`);
    row?.classList.remove('is-unread');
    row?.querySelector('.unread-dot')?.remove();
  }
  openModal(item.title, `<span class="status-chip status-chip--info">${item.category}</span><p style="margin-top:14px">${item.body}</p><p class="muted text-small">${item.time}</p>`, `<button class="button button--primary" type="button" data-action="close-modal">Done</button>`);
}

function showNotificationPreferences() {
  const categories = ['Trip alerts & Support', 'Payments & Wallet', 'Parcels & Luggage', 'Promotions & Alerts'];
  openModal('Notification preferences', `<div class="settings-list">${categories.map((label,index) => `<div class="settings-row"><span class="settings-row__icon"><i data-lucide="bell-ring"></i></span><span class="settings-row__copy"><strong>${label}</strong><span>${index === 3 ? 'Optional marketing messages' : 'Recommended operational alerts'}</span></span><button class="switch ${index !== 3 ? 'is-on' : ''}" type="button" data-action="toggle-switch"><span></span></button></div>`).join('')}</div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="save-preferences">Save Preferences</button>`);
}

function showCallSupport() {
  openModal('Call Taxibee', `<div class="payment-state"><div class="payment-state__icon payment-state__icon--success"><i data-lucide="phone-call"></i></div><h3>+256 700 000 000</h3><p class="muted">Demonstration passenger support number. The prototype does not initiate telephone calls.</p></div>`, `<button class="button button--primary" type="button" data-action="close-modal">Close</button>`);
}

function showChatSupport() {
  openModal('Chat Support preview', `<div class="card card--soft"><p><strong>Taxibee Support</strong><br><span class="muted text-small">Hello Christo. How can we assist with your trip today?</span></p></div><div class="card" style="margin-top:10px;margin-left:18%;background:var(--brand-blue);color:white"><p style="margin:0">I would like to confirm my boarding time.</p></div><div class="field" style="margin-top:14px"><label>Message</label><div class="input-group"><input placeholder="Type a message…"><button class="button button--primary" type="button" data-action="close-modal">Send</button></div></div><p class="privacy-note">Chat messages are not sent or stored.</p>`, '', true);
}

function showSupportStatuses() {
  openModal('Support request SUP-44720', `<div class="timeline">${[['Submitted','Your request was received.'],['Under Review','A support agent is reviewing the request.'],['Waiting for Passenger','Used when more information is needed.'],['Resolved','A resolution has been provided.'],['Closed','The request lifecycle is complete.']].map((item,index) => `<div class="timeline-item ${index < 2 ? 'is-complete' : index === 2 ? 'is-current' : ''}"><span class="timeline-dot"><i data-lucide="${index < 2 ? 'check' : index === 2 ? 'clock-3' : 'circle'}"></i></span><span class="timeline-copy"><strong>${item[0]}</strong><span>${item[1]}</span></span></div>`).join('')}</div>`);
}

window.handleAvatarFileSelect = function(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const preview = document.getElementById('edit-avatar-preview');
      const urlInput = document.getElementById('edit-avatar-url');
      if (preview) preview.src = e.target.result;
      if (urlInput) urlInput.value = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
};

window.setAvatarPreset = function(url) {
  const preview = document.getElementById('edit-avatar-preview');
  const urlInput = document.getElementById('edit-avatar-url');
  if (preview) preview.src = url;
  if (urlInput) urlInput.value = url;
};

function showEditProfile() {
  const currentAvatar = state.userAvatar || 'assets/christo-avatar.jpg';
  const name = state.userName || 'Christo I.';
  const phone = state.userPhone || '+256 772 345 678';
  const email = state.userEmail || 'christo.i@example.com';
  const emergency = state.emergencyContact || '+256 700 123 456';

  openModal('Edit passenger profile & photo', `
    <div class="edit-profile-container">
      <!-- Profile Picture Update Section -->
      <div class="profile-photo-edit-section" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 18px; background: linear-gradient(135deg, rgba(26, 26, 26, 0.05), rgba(26,26,26, 0.02)); border-radius: 18px; border: 1px solid var(--border-strong); margin-bottom: 18px;">
        <div class="profile-avatar-wrapper" style="position: relative; cursor: pointer;" onclick="document.getElementById('profile-file-input').click();" title="Click to upload new photo">
          <img id="edit-avatar-preview" src="${currentAvatar}" alt="Profile Avatar" style="width: 90px; height: 90px; border-radius: 50%; object-fit: cover; border: 3px solid #ffffff; box-shadow: 0 4px 16px rgba(26,26,26, 0.22);">
          <div class="avatar-camera-overlay" style="position: absolute; bottom: 0; right: 0; background: var(--brand-blue); color: white; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; border: 2.5px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.2);">
            <i data-lucide="camera" style="width: 16px; height: 16px;"></i>
          </div>
        </div>
        
        <input type="file" id="profile-file-input" accept="image/*" style="display: none;" onchange="handleAvatarFileSelect(this)">
        
        <div style="margin-top: 10px; text-align: center;">
          <button type="button" class="button button--ghost button--tiny" onclick="document.getElementById('profile-file-input').click();" style="border-radius: 10px; font-weight: 750; color: var(--brand-blue);">
            <i data-lucide="upload" style="width: 14px; height: 14px;"></i> Upload New Photo
          </button>
        </div>

        <div style="margin-top: 12px; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.72rem; color: var(--slate); font-weight: 750;">Presets:</span>
          <img src="assets/christo-avatar.jpg" onclick="setAvatarPreset('assets/christo-avatar.jpg')" alt="Preset 1" style="width: 32px; height: 32px; border-radius: 50%; cursor: pointer; object-fit: cover; border: 2px solid var(--border);" title="Christo Avatar">
          <img src="assets/sam-mcalen.png" onclick="setAvatarPreset('assets/sam-mcalen.png')" alt="Preset 2" style="width: 32px; height: 32px; border-radius: 50%; cursor: pointer; object-fit: cover; border: 2px solid var(--border);" title="Sam Avatar">
          <img src="assets/peebee-logo.svg" onclick="setAvatarPreset('assets/peebee-logo.svg')" alt="Preset 3" style="width: 32px; height: 32px; border-radius: 50%; cursor: pointer; object-fit: cover; border: 2px solid var(--border);" title="Taxibee Logo">
        </div>
        <input type="hidden" id="edit-avatar-url" value="${currentAvatar}">
      </div>

      <div class="form-grid">
        <div class="field field--full">
          <label for="edit-profile-name">Full name</label>
          <input id="edit-profile-name" value="${escapeHtml(name)}">
        </div>
        <div class="field">
          <label for="edit-profile-phone">Telephone</label>
          <input id="edit-profile-phone" value="${escapeHtml(phone)}">
        </div>
        <div class="field">
          <label for="edit-profile-email">Email</label>
          <input id="edit-profile-email" value="${escapeHtml(email)}">
        </div>
        <div class="field field--full">
          <label for="edit-profile-emergency">Emergency contact</label>
          <input id="edit-profile-emergency" value="${escapeHtml(emergency)}">
        </div>
      </div>
    </div>
  `, `
    <button class="button button--ghost" type="button" data-action="close-modal">Cancel</button>
    <button class="button button--primary" type="button" data-action="save-profile">Save Profile & Photo</button>
  `);
}

function showSavedPassengers() {
  openModal('Saved passengers', `<div class="grid"><article class="card card--compact"><div class="card-head"><div><strong>Christo I.</strong><div class="muted text-small">Primary passenger · +256 772 345 678</div></div><span class="status-chip status-chip--success">You</span></div></article><article class="card card--compact"><div class="card-head"><div><strong>Amina Nabirye</strong><div class="muted text-small">Child passenger · Emergency contact linked</div></div><button class="button button--ghost button--tiny" type="button">Edit</button></div></article><button class="button button--primary" type="button" data-action="close-modal"><i data-lucide="user-plus"></i>Add Passenger Preview</button></div>`);
}

function showSavedPickups() {
  openModal('Saved pickup points', `<div class="grid"><article class="card card--compact"><strong>Entebbe Main Stage</strong><p class="muted text-small">Primary boarding point</p></article><article class="card card--compact"><strong>Kitooro</strong><p class="muted text-small">Approved route pickup point</p></article><button class="button button--primary" type="button" data-action="close-modal"><i data-lucide="map-pin-plus"></i>Add Pickup Preview</button></div>`);
}

function showLanguageModal() {
  openModal('Language preview', `<p class="muted">The complete prototype remains in English, but selecting another language demonstrates a sample interface message.</p><div class="radio-cards">${['English','Luganda','Swahili'].map(lang => `<label class="radio-card ${state.language === lang ? 'is-selected' : ''}"><input type="radio" name="language-choice" value="${lang}" ${state.language === lang ? 'checked' : ''}><span class="radio-card__icon"><i data-lucide="languages"></i></span><span class="radio-card__body"><strong>${lang}</strong><span>${lang === 'English' ? 'Travel Smart. Move Faster.' : lang === 'Luganda' ? 'Tambula bulungi, otuuke mangu.' : 'Safiri kwa akili, fika haraka.'}</span></span></label>`).join('')}</div><div class="language-preview">Sample: ${state.language === 'Luganda' ? 'Oli mwetegefu okutambula?' : state.language === 'Swahili' ? 'Uko tayari kusafiri?' : 'Are you ready to travel?'}</div>`, `<button class="button button--ghost" type="button" data-action="close-modal">Cancel</button><button class="button button--primary" type="button" data-action="save-language">Apply Preview</button>`);
}

function saveLanguage() {
  const selected = $('input[name="language-choice"]:checked');
  if (selected) state.language = selected.value;
  closeModal(); renderCurrentScreen(); toast(`${state.language} language preview selected.`, 'success');
}

function showPrivacy() {
  openModal('Privacy preview', `<p>The Taxibee Passenger App mockup does not transmit, persist or process the information entered into its forms. All state is held temporarily in browser memory and resets when the page refreshes.</p><div class="detail-list"><div class="detail-row"><span>Backend connection</span><strong>None</strong></div><div class="detail-row"><span>Database storage</span><strong>None</strong></div><div class="detail-row"><span>Location access</span><strong>Not requested</strong></div><div class="detail-row"><span>Payment processing</span><strong>Not connected</strong></div></div>`);
}

function showTerms() {
  openModal('Terms and conditions preview', `<p>This presentation prototype demonstrates proposed passenger journeys and interface states. It does not create transport contracts, tickets, payments, parcel custody, refunds or service guarantees.</p><ul class="muted"><li>All names and references are fictional demonstration data.</li><li>Fares and times are illustrative and subject to operational validation.</li><li>Buttons demonstrate interface behavior only.</li><li>Refresh the page to reset all session changes.</li></ul>`);
}

function openDemoPanel() {
  const demoStates = ['loading','no-internet','connection-restored','empty-trips','no-parcel','payment-pending','payment-successful','payment-failed','booking-successful','booking-cancelled','wallet-deposit-successful','wallet-insufficient','vehicle-delayed','vehicle-arrived','ticket-expired','ticket-used','parcel-delayed','parcel-ready','support-submitted','session-timeout'];
  openModal('Prototype Demo States', `<p class="muted">Trigger common loading, empty, success, warning and error demonstrations.</p><div class="demo-state-grid">${demoStates.map(label => `<button class="demo-state-button" type="button" data-action="demo-state" data-value="${label}">${label.split('-').map(word => word[0].toUpperCase()+word.slice(1)).join(' ')}</button>`).join('')}</div>`, '', true);
}

function triggerDemoState(value) {
  closeModal();
  const simpleStates = {
    'no-internet': ['No internet connection','The prototype is showing an offline state. No data has been lost.','wifi-off','warning'],
    'connection-restored': ['Connection restored','The passenger experience is back online.','wifi','success'],
    'no-parcel': ['No parcel found','Check the tracking number and try again.','package-x','danger'],
    'payment-pending': ['Payment pending','A mobile-money authorization is awaiting approval.','loader-circle','warning'],
    'payment-successful': ['Payment successful','The demonstration payment was approved.','circle-check-big','success'],
    'payment-failed': ['Payment failed','The demonstration authorization was declined.','circle-x','danger'],
    'booking-cancelled': ['Booking cancelled','Refund status: Pending. Support reference SUP-44720.','calendar-x','warning'],
    'wallet-deposit-successful': ['Wallet deposit successful','UGX 20,000 was added to the preview balance.','wallet-cards','success'],
    'wallet-insufficient': ['Insufficient wallet balance','Add funds or choose another payment method.','wallet-minimal','danger'],
    'vehicle-delayed': ['Vehicle delayed','Traffic has added approximately 15 minutes.','traffic-cone','warning'],
    'vehicle-arrived': ['Vehicle arrived','UBM 245K is ready for boarding.','bus-front','success'],
    'ticket-expired': ['Ticket expired','This ticket is outside its validity window.','ticket-x','warning'],
    'ticket-used': ['Ticket already used','Verification code 482915 has already been validated.','ticket-check','warning'],
    'parcel-delayed': ['Parcel delayed','Expected arrival has changed to 11:10 AM.','package-x','warning'],
    'parcel-ready': ['Parcel ready for collection','Present collection PIN 742915 at Kampala Main Stage.','package-check','success'],
    'support-submitted': ['Support request submitted','Reference SUP-44720 is under review.','messages-square','success'],
    'session-timeout': ['Session timeout','The production app would ask the passenger to sign in again.','timer-off','warning']
  };
  if (value === 'loading') { showLoading('Loading demonstration state…', () => toast('Loading state completed.', 'success'), 1200); return; }
  if (value === 'empty-trips') { state.tripTab = 'cancelled'; navigate('trips'); toast('Empty trip-history state is displayed below the sample cancellation.', 'warning'); return; }
  if (value === 'booking-successful') { navigate('success'); return; }
  if (value === 'parcel-delayed') { state.parcelTrackingState = 'delayed'; navigate('trackparcel'); return; }
  if (value === 'parcel-ready') { state.parcelTrackingState = 'ready'; navigate('trackparcel'); return; }
  if (value.startsWith('ticket-')) {
    state.ticketStatus = value.replace('ticket-', '');
    navigate('ticket');
    toast(`${state.ticketStatus.replace('-', ' ')} ticket state displayed.`, state.ticketStatus === 'active' ? 'success' : 'warning');
    return;
  }
  const item = simpleStates[value];
  if (item) showStateModal(item[0],item[1],item[2],item[3]);
}

function showStateModal(title, copy, icon, type = 'info') {
  const style = type === 'success' ? 'success' : type === 'danger' ? 'failed' : 'pending';
  openModal(title, `<div class="payment-state"><div class="payment-state__icon payment-state__icon--${style}"><i data-lucide="${icon}"></i></div><h3>${title}</h3><p class="muted">${copy}</p></div>`, `<button class="button button--primary" type="button" data-action="close-modal">Done</button>`);
}

function signOut() {
  const session = getAuthSession();
  if (session && session.username) {
    recordLoginLog(session.username, 'LOGOUT', 'User signed out of session');
  }
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  $('#app-shell').classList.add('is-hidden');
  $('#auth-layer').classList.remove('is-hidden');
  state.authView = 'signin'; 
  state.history = []; 
  state.screen = 'home';
  renderAuth();
  toast('Signed out successfully. Platform is locked.', 'info');
}

// ---------- Geolocation: Detect nearest origin city ----------
function detectNearestCity() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    // Collect unique city endpoints with coordinates
    const cities = [];
    const seen = new Set();
    appData.routeCards.forEach(rc => {
      if (!seen.has(rc.cityA)) { seen.add(rc.cityA); cities.push({ name: rc.cityA, lat: rc.coordA[0], lng: rc.coordA[1] }); }
      if (!seen.has(rc.cityB)) { seen.add(rc.cityB); cities.push({ name: rc.cityB, lat: rc.coordB[0], lng: rc.coordB[1] }); }
    });
    // Find nearest city by Haversine-like distance
    let nearest = cities[0];
    let minDist = Infinity;
    cities.forEach(c => {
      const d = Math.pow(lat - c.lat, 2) + Math.pow(lng - c.lng, 2);
      if (d < minDist) { minDist = d; nearest = c; }
    });
    state.detectedOriginCity = nearest.name;
    // Auto-flip routes where user is closer to cityB
    appData.routeCards.forEach(rc => {
      const distA = Math.pow(lat - rc.coordA[0], 2) + Math.pow(lng - rc.coordA[1], 2);
      const distB = Math.pow(lat - rc.coordB[0], 2) + Math.pow(lng - rc.coordB[1], 2);
      if (distB < distA) {
        state.routeFlips[rc.key] = true;
      }
    });
    // Update the currently selected route's searchFrom/searchTo
    const rc = appData.routeCards.find(r => r.key === state.selectedRoute);
    if (rc) {
      const flipped = !!state.routeFlips[rc.key];
      state.searchFrom = flipped ? rc.stageB : rc.stageA;
      state.searchTo = flipped ? rc.stageA : rc.stageB;
    }
    // Only re-render if we are on the Home screen or booking step 1 to prevent interrupting active flows
    if (state.screen === 'home' || (state.screen === 'book' && state.bookingStep === 1)) {
      renderCurrentScreen();
    }
  }, () => { /* Permission denied or error — keep defaults */ }, { timeout: 5000 });
}

// ---------- Dynamic Transparent Vehicle Background Cut-out ----------
function makeImageTransparent(imgUrl, callback) {
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = imgUrl;
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const width = canvas.width;
      const height = canvas.height;
      
      const visited = new Uint8Array(width * height);
      const queue = [];
      
      function isWhite(x, y) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        return (r > 240 && g > 240 && b > 240);
      }
      
      // Add corners to queue
      const corners = [
        [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]
      ];
      for (const [cx, cy] of corners) {
        if (isWhite(cx, cy)) {
          queue.push(cx, cy);
          visited[cy * width + cx] = 1;
        }
      }
      
      let head = 0;
      while (head < queue.length) {
        const x = queue[head++];
        const y = queue[head++];
        
        const idx = (y * width + x) * 4;
        data[idx + 3] = 0; // set alpha to 0 (transparent)
        
        const neighbors = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nidx = ny * width + nx;
            if (!visited[nidx] && isWhite(nx, ny)) {
              visited[nidx] = 1;
              queue.push(nx, ny);
            }
          }
        }
      }
      
      ctx.putImageData(imgData, 0, 0);
      callback(canvas.toDataURL('image/png'));
    } catch (e) {
      callback(imgUrl);
    }
  };
  img.onerror = () => callback(imgUrl);
}

function getDriverHeroImage(driverNameKey) {
  const key = (driverNameKey || '').toLowerCase().trim();
  const dObj = driversData[key] || driversData['isaac muwonge'];
  return dObj.hero || dObj.avatar || 'assets/driver_1_hero-branded.png';
}

function getTripVehicleImage(vehicleName, index = 0) {
  if (!vehicleName) return 'assets/driver_7_hero-branded.png';
  const name = vehicleName.toLowerCase();
  let imgUrl = 'assets/driver_7_hero-branded.png';

  if (name.includes('highroof')) {
    imgUrl = 'assets/taxibee-highroof-branded.png';
  } else if (name.includes('coaster')) {
    imgUrl = 'assets/taxibee-coaster-branded.png';
  } else if (name.includes('minivan') || name.includes('alphard')) {
    imgUrl = 'assets/taxibee-minivan-branded.png';
  } else if (name.includes('noah')) {
    imgUrl = 'assets/taxibee-noah-branded.png';
  } else if (name.includes('sedan') || name.includes('saloon')) {
    imgUrl = 'assets/taxibee-sedan-branded.png';
  } else {
    imgUrl = (index % 2 === 1) ? 'assets/taxibee-van.png' : 'assets/driver_7_hero-branded.png';
  }

  return state.transparentVehicles[imgUrl] || imgUrl;
}

function preloadTransparentImages() {
  const vehicleImages = [
    'assets/taxibee-sedan-branded.png',
    'assets/taxibee-noah-branded.png',
    'assets/taxibee-minivan-branded.png',
    'assets/taxibee-van.png',
    'assets/taxibee-highroof-branded.png',
    'assets/taxibee-coaster-branded.png',
    'assets/taxibee-van.png'
  ];
  vehicleImages.forEach(imgUrl => {
    makeImageTransparent(imgUrl, (pngUrl) => {
      state.transparentVehicles[imgUrl] = pngUrl;
      renderCurrentScreen();
    });
  });
}

function initTrackingMiniMaps() {
  if (!window.L) return;
  
  if (window.trackingMiniMaps && Array.isArray(window.trackingMiniMaps)) {
    window.trackingMiniMaps.forEach(m => {
      try { m.remove(); } catch(e) {}
    });
  }
  window.trackingMiniMaps = [];

  const mapTargets = [
    { id: 'mini-map-travel-FET-884210', route: 'entebbe', isReverse: false, progress: 0.6, type: 'live' },
    { id: 'mini-map-travel-FET-883109', route: 'entebbe', isReverse: true, progress: 1.0, type: 'completed' },
    { id: 'mini-map-travel-FET-880291', route: 'entebbe', isReverse: false, progress: 0.0, type: 'cancelled' },
    { id: 'mini-map-parcel-964201832-DL', route: 'entebbe', isReverse: false, progress: 0.4, type: 'live' },
    { id: 'mini-map-parcel-964201710-DL', route: 'entebbe', isReverse: false, progress: 1.0, type: 'completed' },
    { id: 'mini-map-parcel-964200988-DL', route: 'entebbe', isReverse: true, progress: 1.0, type: 'completed' },
    { id: 'mini-map-vehicle-UBM-245K', route: 'entebbe', isReverse: false, progress: 0.0, type: 'live' },
    { id: 'mini-map-vehicle-UBN-742D', route: 'entebbe', isReverse: true, progress: 0.8, type: 'live' }
  ];

  mapTargets.forEach(targetSpec => {
    const el = document.getElementById(targetSpec.id);
    if (!el) return;

    try {
      const map = L.map(el, {
        attributionControl: false,
        zoomControl: false,
        boxZoom: false,
        doubleClickZoom: false,
        dragging: false,
        keyboard: false,
        scrollWheelZoom: false,
        touchZoom: false
      });

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        crossOrigin: false
      }).addTo(map);

      const points = getCurrentRoutePoints(targetSpec.route, targetSpec.isReverse);
      
      // Draw light polyline for path
      L.polyline(points, { color: '#0a0a0a', opacity: 0.35, weight: 4 }).addTo(map);
      
      // Get point location
      const idx = Math.min(points.length - 1, Math.max(0, Math.floor(points.length * targetSpec.progress)));
      const activePoint = points[idx];
      
      // Choose marker fill color
      let markerColor = '#c9a227'; // blue
      if (targetSpec.type === 'completed') {
        markerColor = '#138a59'; // green
      } else if (targetSpec.type === 'cancelled') {
        markerColor = '#c9a227'; // red
      }

      L.circleMarker(activePoint, {
        color: '#fff',
        fillColor: markerColor,
        fillOpacity: 1,
        radius: 6,
        weight: 2
      }).addTo(map);

      map.setView(activePoint, 13);
      window.trackingMiniMaps.push(map);
    } catch (err) {
      console.error('Failed to init mini-map:', targetSpec.id, err);
    }
  });
}

function findMatchingRoutes(query) {
  if (!query) return [];
  let q = query.toLowerCase().trim();
  if (q.includes('kajjansi')) q = q.replace(/kajjansi/g, 'kajansi');
  return appData.routeCards.filter(rc => {
    const normCorridor = rc.corridor.toLowerCase().replace(/kajjansi/g, 'kajansi');
    const normVia = rc.via.toLowerCase().replace(/kajjansi/g, 'kajansi');
    const normKey = rc.key.toLowerCase().replace(/kajjansi/g, 'kajansi');
    return rc.cityA.toLowerCase().includes(q) ||
           rc.cityB.toLowerCase().includes(q) ||
           rc.stageA.toLowerCase().includes(q) ||
           rc.stageB.toLowerCase().includes(q) ||
           normCorridor.includes(q) ||
           normVia.includes(q) ||
           normKey.includes(q);
  });
}

function handleSearchSubmit(query) {
  if (!query || !query.trim()) {
    toast('Please enter a destination, stage, or town to search.', 'warning');
    return;
  }
  state.homeSearchQuery = query;
  navigate('search-results');
}

function renderSearchResultsScreen() {
  const query = state.homeSearchQuery || '';
  const matchingRoutes = findMatchingRoutes(query);
  
  return `
    ${screenHead('Search Corridors', `Search results for "${escapeHtml(query)}"`)}
    
    <form class="search-row" onsubmit="event.preventDefault(); handleSearchSubmit(this.querySelector('.search-input').value);" style="margin-top: 16px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; margin-bottom: 22px;">
      <div style="position: relative; display: flex; align-items: center; min-width: 0;">
        <i data-lucide="search" style="position: absolute; left: 16px; color: var(--muted); width: 18px; height: 18px; pointer-events: none;"></i>
        <input class="search-input" type="text" placeholder="Search route, stage or service..." style="width: 100%; min-height: 50px; border-radius: 14px; border: 1px solid var(--border); padding: 0 16px 0 46px; background: white; font-weight: 650; color: var(--ink); outline: none; font-size: 0.95rem;" value="${escapeHtml(query)}" />
      </div>
      <button class="button button--ghost" type="submit" style="min-height: 50px; border-radius: 14px; padding-inline: 20px; font-weight: 700; cursor: pointer; color: var(--brand-blue);">Search</button>
    </form>

    <div class="search-results-list" style="display: grid; gap: 16px;">
      ${matchingRoutes.length ? matchingRoutes.map(rc => {
        const stations = rc.corridor.split(' \u2022 ');
        const formattedCorridor = stations.map(s => {
          const normS = s.toLowerCase().replace(/kajjansi/g, 'kajansi');
          const normQ = query.toLowerCase().replace(/kajjansi/g, 'kajansi');
          const isMatch = query && normS.includes(normQ);
          return isMatch ? `<strong style="color: var(--brand-blue); background: var(--info-soft); padding: 2px 6px; border-radius: 6px;">${s}</strong>` : s;
        }).join(' \u2192 ');

        return `
          <article class="card search-result-card" style="margin: 0; padding: 18px; display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--border); box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s;">
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 12px;">
              <div>
                <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 750; display: block;">${rc.via}</span>
                <h3 style="margin: 4px 0 0; font-size: 1.25rem; font-weight: 850; color: var(--brand-blue-dark);">${rc.cityA} &rarr; ${rc.cityB}</h3>
              </div>
              <div style="text-align: right;">
                <span class="muted" style="font-size: 0.75rem; display: block;">Fare from</span>
                <strong style="font-size: 1.15rem; color: var(--brand-blue); font-weight: 800;">${rc.price}</strong>
              </div>
            </div>

            <div style="font-size: 0.88rem; background: var(--page); padding: 12px; border-radius: 12px; border: 1px solid rgba(0,0,0,0.03);">
              <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 6px; color: var(--muted); font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em;">
                <i data-lucide="route" style="width: 14px; height: 14px;"></i> Corridor Stages
              </div>
              <p style="margin: 0; line-height: 1.45; color: var(--charcoal); font-weight: 550;">${formattedCorridor}</p>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span style="font-size: 0.82rem; color: var(--muted); font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                <i data-lucide="check" style="width: 14px; height: 14px; color: var(--success); stroke-width: 3;"></i> Bookable Online
              </span>
              <button class="button button--primary button--small" type="button" data-action="book-searched-route" data-route="${rc.key}">
                Book Ride
              </button>
            </div>
          </article>
        `;
      }).join('') : `
        <div class="card" style="margin: 0; padding: 36px 20px; text-align: center; display: grid; justify-items: center; gap: 16px;">
          <div style="background: var(--red-soft); color: var(--brand-red); display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%;">
            <i data-lucide="search" style="width: 32px; height: 32px;"></i>
          </div>
          <div>
            <h3 style="margin: 0 0 6px; font-size: 1.15rem; font-weight: 800; color: var(--brand-blue-dark);">No Corridors Found</h3>
            <p class="muted" style="margin: 0; font-size: 0.88rem; max-width: 280px; margin-inline: auto;">We couldn't find any active transit corridors matching "${escapeHtml(query)}".</p>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 8px;">
            <button class="button button--ghost button--small" type="button" onclick="handleSearchSubmit('Kajjansi')">Try Kajjansi</button>
            <button class="button button--ghost button--small" type="button" onclick="handleSearchSubmit('Masaka')">Try Masaka</button>
            <button class="button button--ghost button--small" type="button" onclick="handleSearchSubmit('Kampala')">Try Kampala</button>
          </div>
        </div>
      `}
    </div>

    <div class="floating-cta-container" style="margin-top: 24px;">
      <button class="button button--ghost w-full" type="button" data-screen="home">Back to Home</button>
    </div>
  `;
}

function renderAvailableVansScreen() {
  const allTrips = appData.trips;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  const availableVans = allTrips.filter(trip => {
    const departMins = timeToMinutes(trip.depart);
    let diff = departMins - currentMinutes;
    if (diff < 0) diff += 1440; // wrap around midnight
    return diff <= 180; // 3 hours window
  });

  return `
    ${screenHead('Available Departures', 'Real-time schedule of active departures leaving Entebbe within a 3-hour window.')}

    <div class="available-vans-list" style="display: grid; gap: 16px;">
      ${availableVans.length ? availableVans.map((trip, idx) => {
        const isWarning = trip.seats <= 2;
        return `
          <article class="card" style="margin: 0; padding: 18px; border: 1px solid var(--border); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; text-align: left; background: white; border-radius: 20px; gap: 14px;">
            <div style="position: relative; width: 100%; height: 160px; overflow: hidden; background: var(--surface-alt); border-radius: 14px;">
              <img src="${trip.img}" alt="${trip.driverName}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 14px;" />
              <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.4), transparent 60%); border-radius: 14px;"></div>
              <span style="position: absolute; bottom: 12px; left: 12px; font-size: 0.72rem; font-weight: 750; color: white; background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em; backdrop-filter: blur(4px); display: inline-flex; align-items: center; gap: 4px;">
                <i data-lucide="info" style="width: 12px; height: 12px;"></i> ${trip.vehicle} ${idx === 0 ? '· Boarding Now' : `· ${trip.countdown}`}
              </span>
              ${idx === 0 ? `
                <span style="position: absolute; top: 12px; right: 12px; background: var(--brand-blue); color: white; font-size: 0.68rem; text-align: center; font-weight: 850; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.05em; box-shadow: var(--shadow-sm);">BOARDING</span>
              ` : `
                <span style="position: absolute; top: 12px; right: 12px; background: var(--slate); color: white; font-size: 0.68rem; text-align: center; font-weight: 850; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.05em; box-shadow: var(--shadow-sm);">WAITING</span>
              `}
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 14px;">
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                  <span style="font-size: 0.72rem; text-transform: uppercase; font-weight: 600; color: var(--muted); letter-spacing: 0.05em;">${trip.via}</span>
                  <span class="capacity-chip ${isWarning ? 'warning' : ''}" style="font-size: 0.78rem; padding: 4px 10px; flex-shrink: 0;">
                    ${trip.seats} space${trip.seats === 1 ? '' : 's'} available
                  </span>
                </div>
                <h3 style="margin: 2px 0 0 0; font-size: 1.25rem; font-weight: 800; color: var(--brand-blue-dark); width: 100%;">${trip.boarding.split(' ')[0]} &rarr; ${trip.destination.split(' ')[0]}</h3>
              </div>
              
              <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; color: var(--slate); font-weight: 400; padding-bottom: 2px;">
                <span style="display: flex; align-items: center; gap: 4px;">
                  <i data-lucide="user" style="width: 14px; height: 14px; color: var(--muted);"></i> Driver: <span style="font-weight: 600; color: var(--charcoal);">${trip.driverName}</span>
                </span>
                <span style="display: flex; align-items: center; gap: 3px;">
                  <i data-lucide="star" style="width: 13px; height: 13px; fill: var(--brand-gold); color: var(--brand-gold);"></i> <span style="font-weight: 600;">${trip.driverRating}</span>
                </span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; background: var(--page); padding: 10px 16px; border-radius: 12px; text-align: center; border: 1px solid rgba(0,0,0,0.02);">
                <div>
                  <span style="font-size: 0.7rem; color: var(--muted); text-transform: uppercase; font-weight: 600; display: block;">Boarding</span>
                  <strong style="font-size: 0.92rem; color: ${idx === 0 ? 'var(--brand-blue-dark)' : 'var(--charcoal)'}; font-weight: 800;">${idx === 0 ? 'Now' : trip.depart}</strong>
                </div>
                <div>
                  <span style="font-size: 0.7rem; color: var(--muted); text-transform: uppercase; font-weight: 600; display: block;">Duration</span>
                  <strong style="font-size: 0.92rem; color: var(--charcoal); font-weight: 800;">${trip.duration}</strong>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
                <strong style="font-size: 1.25rem; color: var(--brand-blue); font-weight: 850;">${trip.price}</strong>
                <button class="button button--primary button--small" type="button" data-action="select-departure-direct" data-trip-id="${trip.id}">
                  Select &amp; Book
                </button>
              </div>
            </div>
          </article>
        `;
      }).join('') : `
        <div class="card" style="margin: 0; padding: 36px 20px; text-align: center; display: grid; justify-items: center; gap: 16px;">
          <div style="background: var(--warning-soft); color: var(--warning); display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%;">
            <i data-lucide="clock" style="width: 32px; height: 32px;"></i>
          </div>
          <div>
            <h3 style="margin: 0 0 6px; font-size: 1.15rem; font-weight: 800; color: var(--brand-blue-dark);">No Upcoming Departures</h3>
            <p class="muted" style="margin: 0; font-size: 0.88rem; max-width: 280px; margin-inline: auto;">There are no scheduled departures in the next 3 hours. Please check back later.</p>
          </div>
        </div>
      `}
    </div>

    <div class="floating-cta-container" style="margin-top: 24px;">
      <button class="button button--ghost w-full" type="button" data-screen="home">Back to Home</button>
    </div>
  `;
}

// Global error logging for prototype debugging
window.addEventListener('error', (event) => {
  const msg = `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
  console.error("PROTOTYPE EXCEPTION: ", msg);
  if (typeof toast === 'function') {
    toast(`[JS Error] ${event.message}`, 'danger');
  }
});
window.addEventListener('unhandledrejection', (event) => {
  console.error("PROTOTYPE PROMISE REJECTION: ", event.reason);
  if (typeof toast === 'function') {
    toast(`[Promise Error] ${event.reason?.message || event.reason}`, 'danger');
  }
});

// Typed integration layer reads the original presentation state without duplicating its UI.
window.TaxibeeSource = { appData, state, driversData };
