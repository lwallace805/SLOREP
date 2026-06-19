"use client";

import { useState } from "react";

// Show data from the PDF form
const MAINSTAGE_SHOWS = [
  {
    id: "father",
    name: "THE FATHER",
    dates: "Aug 28 - Sep 13, 2026",
    performances: [
      { day: "Wed", time: "7pm", dates: ["8/28", "9/3", "9/10"] },
      { day: "Thu", time: "7pm", dates: ["8/29", "9/4", "9/11"] },
      { day: "Fri", time: "7pm", dates: ["8/29", "9/5", "9/12"] },
      { day: "Sat", time: "2pm", dates: ["8/30", "9/6", "9/13"] },
      { day: "Sat", time: "7pm", dates: ["8/30", "9/5", "9/12"] },
      { day: "Sun", time: "2pm", dates: ["9/6", "9/13"] },
    ],
  },
  {
    id: "gutenberg",
    name: "GUTENBERG! THE MUSICAL!",
    dates: "Oct 9 - Nov 8, 2026",
    performances: [
      { day: "Wed", time: "7pm", dates: ["10/9", "10/15", "10/22", "10/29", "11/5"] },
      { day: "Thu", time: "7pm", dates: ["10/10", "10/16", "10/23", "10/30", "11/6"] },
      { day: "Fri", time: "7pm", dates: ["10/10", "10/17", "10/24", "10/31", "11/7"] },
      { day: "Sat", time: "2pm", dates: ["10/11", "10/18", "10/25", "11/1", "11/8"] },
      { day: "Sat", time: "7pm", dates: ["10/11", "10/18", "10/25", "11/1", "11/7"] },
      { day: "Sun", time: "2pm", dates: ["10/12", "10/19", "10/26", "11/2", "11/8"] },
    ],
  },
  {
    id: "seminar",
    name: "SEMINAR",
    dates: "Apr 2 - 18, 2027",
    performances: [
      { day: "Wed", time: "7pm", dates: ["4/2", "4/8", "4/15"] },
      { day: "Thu", time: "7pm", dates: ["4/3", "4/9", "4/16"] },
      { day: "Fri", time: "7pm", dates: ["4/3", "4/10", "4/17"] },
      { day: "Sat", time: "2pm", dates: ["4/4", "4/11", "4/18"] },
      { day: "Sat", time: "7pm", dates: ["4/4", "4/10", "4/17"] },
      { day: "Sun", time: "2pm", dates: ["4/5", "4/11", "4/18"] },
    ],
  },
  {
    id: "spelling-bee",
    name: "25TH ANNUAL PUTNAM COUNTY SPELLING BEE",
    dates: "Jun 11 - Jul 3, 2027",
    performances: [
      { day: "Wed", time: "7pm", dates: ["6/11", "6/18", "6/25", "7/2"] },
      { day: "Thu", time: "7pm", dates: ["6/12", "6/19", "6/26", "7/3"] },
      { day: "Fri", time: "7pm", dates: ["6/12", "6/19", "6/26", "7/3"] },
      { day: "Sat", time: "2pm", dates: ["6/13", "6/20", "6/27", "7/4"] },
      { day: "Sat", time: "7pm", dates: ["6/13", "6/20", "6/27", "7/4"] },
      { day: "Sun", time: "2pm", dates: ["6/14", "6/21", "6/28", "7/5"] },
    ],
  },
  {
    id: "three-tall-women",
    name: "THREE TALL WOMEN",
    dates: "May 7 - 23, 2027",
    performances: [
      { day: "Wed", time: "7pm", dates: ["5/7", "5/13", "5/20"] },
      { day: "Thu", time: "7pm", dates: ["5/8", "5/14", "5/21"] },
      { day: "Fri", time: "7pm", dates: ["5/8", "5/15", "5/22"] },
      { day: "Sat", time: "2pm", dates: ["5/9", "5/16", "5/23"] },
      { day: "Sat", time: "7pm", dates: ["5/9", "5/15", "5/22"] },
      { day: "Sun", time: "2pm", dates: ["5/10", "5/16", "5/23"] },
    ],
  },
];

const STAGED_READINGS = [
  { id: "designated-mourner", name: "THE DESIGNATED MOURNER", dates: ["8/7/26", "8/8/26", "8/8/26"] },
  { id: "vertical-hour", name: "THE VERTICAL HOUR", dates: ["9/18/26", "9/19/26", "9/19/26"] },
  { id: "the-guys", name: "THE GUYS", dates: ["1/29/27", "1/30/27", "1/30/27"] },
  { id: "incognito", name: "INCOGNITO", dates: ["3/19/27", "3/20/27", "3/20/27"] },
  { id: "nickel-dimed", name: "NICKEL & DIMED", dates: ["4/23/27", "4/24/27", "4/24/27"] },
];

const HOLIDAY_SHOW = {
  id: "million-dollar-quartet",
  name: "MILLION DOLLAR QUARTET CHRISTMAS",
  dates: "Nov 20 - Dec 20, 2026",
  price: { premium: 60, preferred: 55, student: 40 },
  performances: [
    { day: "Wed", time: "7pm", dates: ["11/20", "12/2", "12/9", "12/16"] },
    { day: "Thu", time: "7pm", dates: ["11/21", "12/3", "12/10", "12/17"] },
    { day: "Fri", time: "7pm", dates: ["11/21", "12/5", "12/11", "12/18"] },
    { day: "Sat", time: "2pm", dates: ["11/22", "12/6", "12/12", "12/19"] },
    { day: "Sat", time: "7pm", dates: ["11/22", "12/6", "12/12", "12/19"] },
    { day: "Sun", time: "2pm", dates: ["11/23", "12/7", "12/13", "12/20"] },
  ],
};

const SPECIAL_EVENT = {
  id: "forever-plaid",
  name: "FOREVER PLAID",
  dates: "Feb 12 - Mar 14, 2027",
  price: { premium: 60, preferred: 55, student: 40 },
  performances: [
    { day: "Wed", time: "7pm", dates: ["2/12", "2/19", "2/26", "3/5", "3/12"] },
    { day: "Thu", time: "7pm", dates: ["2/13", "2/20", "2/27", "3/6", "3/13"] },
    { day: "Fri", time: "7pm", dates: ["2/13", "2/20", "2/27", "3/6", "3/13"] },
    { day: "Sat", time: "2pm", dates: ["2/14", "2/21", "2/28", "3/7", "3/14"] },
    { day: "Sat", time: "7pm", dates: ["2/14", "2/21", "2/28", "3/7", "3/13"] },
    { day: "Sun", time: "2pm", dates: ["2/15", "2/22", "3/1", "3/8", "3/14"] },
  ],
};

const ACT_SHOWS = [
  {
    id: "finding-nemo",
    name: "FINDING NEMO",
    dates: "Jul 10 - 19, 2026",
    price: { premium: 27, preferred: 25, student: 20 },
    note: "Due to July show dates, these tickets will be held at will call.",
    performances: [
      { day: "Wed", time: "7pm", dates: ["7/10"] },
      { day: "Thu", time: "7pm", dates: ["7/11"] },
      { day: "Fri", time: "7pm", dates: ["7/11"] },
      { day: "Sat", time: "2pm", dates: ["7/12"] },
      { day: "Sat", time: "7pm", dates: ["7/12"] },
      { day: "Sun", time: "2pm", dates: ["7/13"] },
      { day: "Sun", time: "7pm", dates: ["7/13"] },
    ],
  },
  {
    id: "number-the-stars",
    name: "NUMBER THE STARS",
    dates: "Jan 15 - 24, 2027",
    price: { premium: 25, preferred: 23, student: 20 },
    performances: [
      { day: "Wed", time: "7pm", dates: ["1/15"] },
      { day: "Thu", time: "7pm", dates: ["1/16"] },
      { day: "Fri", time: "7pm", dates: ["1/16"] },
      { day: "Sat", time: "2pm", dates: ["1/17"] },
      { day: "Sat", time: "7pm", dates: ["1/17"] },
      { day: "Sun", time: "2pm", dates: ["1/18"] },
    ],
  },
];

const SEATING_OPTIONS = [
  { value: "best-available", label: "Best Available" },
  { value: "premium", label: "Premium" },
  { value: "preferred", label: "Preferred" },
  { value: "ada", label: "ADA Accessible" },
  { value: "ada-wheelchair", label: "ADA / Wheelchair" },
];

export default function SeasonSubscription() {
  const [step, setStep] = useState(1);
  const [subscriberStatus, setSubscriberStatus] = useState<"returning" | "new" | "">("");
  const [selectedDates, setSelectedDates] = useState<Record<string, string[]>>({});
  const [ubusSelected, setUbusSelected] = useState<Record<string, string>>({});
  const [holidayTickets, setHolidayTickets] = useState({ premium: 0, preferred: 0, student: 0 });
  const [specialEventTickets, setSpecialEventTickets] = useState({ premium: 0, preferred: 0, student: 0 });
  const [actTickets, setActTickets] = useState<Record<string, { premium: number; preferred: number; student: number }>>({});
  const [seatingPreference, setSeatingPreference] = useState("");
  const [specificSeats, setSpecificSeats] = useState("");
  const [contact, setContact] = useState({ name: "", address: "", city: "", state: "", zip: "", phone: "", email: "" });
  const [paymentMethod, setPaymentMethod] = useState<"credit" | "check" | "">("");
  const [donation, setDonation] = useState({ annualFund: 0, act: 0, capitalCampaign: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const toggleDate = (showId: string, date: string) => {
    setSelectedDates((prev) => {
      const current = prev[showId] || [];
      if (current.includes(date)) {
        return { ...prev, [showId]: current.filter((d) => d !== date) };
      }
      // Limit to 3 choices per show
      if (current.length >= 3) return prev;
      return { ...prev, [showId]: [...current, date] };
    });
  };

  const calculateTotal = () => {
    let total = 0;
    
    // Mainstage subscription
    if (subscriberStatus) total += 200;
    
    // Ubu's Other Shoe
    if (Object.keys(ubusSelected).length > 0) total += 95;
    
    // Holiday show
    total += holidayTickets.premium * 60 + holidayTickets.preferred * 55 + holidayTickets.student * 40;
    
    // Special event
    total += specialEventTickets.premium * 60 + specialEventTickets.preferred * 55 + specialEventTickets.student * 40;
    
    // ACT shows
    Object.entries(actTickets).forEach(([showId, tickets]) => {
      const show = ACT_SHOWS.find((s) => s.id === showId);
      if (show) {
        total += tickets.premium * show.price.premium + tickets.preferred * show.price.preferred + tickets.student * show.price.student;
      }
    });
    
    // Handling fee
    total += 10;
    
    // Donations
    total += donation.annualFund + donation.act + donation.capitalCampaign;
    
    return total;
  };

  const handleSubmit = () => {
    const orderDetails = `
SLO REP Season Subscription Order
================================

Subscriber Status: ${subscriberStatus === "returning" ? "Returning Subscriber" : "New Subscriber"}

MAINSTAGE SHOWS
${MAINSTAGE_SHOWS.map(show => {
  const dates = selectedDates[show.id] || [];
  return dates.length > 0 ? `${show.name}: ${dates.join(", ")}` : "";
}).filter(Boolean).join("\n")}

UBU'S OTHER SHOE (STAGED READINGS)
${Object.entries(ubusSelected).map(([id, date]) => {
  const show = STAGED_READINGS.find(s => s.id === id);
  return show ? `${show.name}: ${date}` : "";
}).filter(Boolean).join("\n")}

A LA CARTE ADD-ONS
Million Dollar Quartet Christmas: ${holidayTickets.premium} premium, ${holidayTickets.preferred} preferred, ${holidayTickets.student} student
Forever Plaid: ${specialEventTickets.premium} premium, ${specialEventTickets.preferred} preferred, ${specialEventTickets.student} student
${ACT_SHOWS.map(show => {
  const t = actTickets[show.id] || { premium: 0, preferred: 0, student: 0 };
  return (t.premium + t.preferred + t.student) > 0 
    ? `${show.name}: ${t.premium} premium, ${t.preferred} preferred, ${t.student} student`
    : "";
}).filter(Boolean).join("\n")}

SEATING PREFERENCE
${SEATING_OPTIONS.find(o => o.value === seatingPreference)?.label || "Best Available"}
${specificSeats ? `Specific seats: ${specificSeats}` : ""}

CONTACT INFORMATION
Name: ${contact.name}
Address: ${contact.address}
City: ${contact.city}, ${contact.state} ${contact.zip}
Phone: ${contact.phone}
Email: ${contact.email}

PAYMENT METHOD
${paymentMethod === "credit" ? "Credit Card (will call to process)" : "Check enclosed"}

DONATIONS
Annual Fund: $${donation.annualFund}
ACT Program: $${donation.act}
Capital Campaign: $${donation.capitalCampaign}

TOTAL: $${calculateTotal()}
    `.trim();

    const mailtoLink = `mailto:boxoffice@slorep.org?subject=Season Subscription Order - ${contact.name}&body=${encodeURIComponent(orderDetails)}`;
    window.open(mailtoLink, "_blank");
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🎭</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h1>
          <p className="text-gray-600 mb-4">
            Your season subscription order has been submitted. The SLO REP box office will contact you to confirm your seats.
          </p>
          <div className="bg-gray-100 rounded p-4 text-sm text-gray-600">
            <p>Questions? Call (805) 786-2440</p>
            <p>or email boxoffice@slorep.org</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900">SLO REP Season Subscription</h1>
          <p className="text-sm text-gray-500">2026-2027 Season</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className={`flex-1 h-2 rounded-full ${s <= step ? "bg-blue-600" : "bg-gray-200"}`} />
          ))}
        </div>

        {/* Step 1: Subscriber Status + Mainstage Shows */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">Step 1: Subscriber Status</h2>
              <div className="flex gap-4">
                <button
                  onClick={() => setSubscriberStatus("returning")}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                    subscriberStatus === "returning"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  Returning Subscriber
                </button>
                <button
                  onClick={() => setSubscriberStatus("new")}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                    subscriberStatus === "new"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  New Subscriber
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-2">Step 2: Mainstage Season Shows</h2>
              <p className="text-sm text-gray-500 mb-4">
                Select up to 3 preferred dates for each show. 5-show subscription: $200
              </p>
              
              <div className="space-y-6">
                {MAINSTAGE_SHOWS.map((show) => (
                  <div key={show.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-gray-900">{show.name}</h3>
                      <span className="text-sm text-gray-500">{show.dates}</span>
                    </div>
                    
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {show.performances.map((perf) =>
                        perf.dates.map((date) => (
                          <button
                            key={`${show.id}-${date}-${perf.day}`}
                            onClick={() => toggleDate(show.id, `${perf.day} ${date} ${perf.time}`)}
                            className={`py-2 px-1 rounded text-xs font-medium transition-colors ${
                              selectedDates[show.id]?.includes(`${perf.day} ${date} ${perf.time}`)
                                ? "bg-blue-600 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            <div>{perf.day}</div>
                            <div>{date}</div>
                            <div className="text-[10px]">{perf.time}</div>
                          </button>
                        ))
                      )}
                    </div>
                    
                    {selectedDates[show.id]?.length > 0 && (
                      <div className="mt-3 text-sm text-blue-600">
                        Selected: {selectedDates[show.id].join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!subscriberStatus}
                className="bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Add-Ons
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Add-ons */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Staged Readings */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-2">Ubu's Other Shoe — Staged Readings</h2>
              <p className="text-sm text-gray-500 mb-4">5-show subscription: $95</p>
              
              <div className="space-y-3">
                {STAGED_READINGS.map((show) => (
                  <div key={show.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div>
                      <div className="font-medium">{show.name}</div>
                      <div className="text-sm text-gray-500">
                        {show.dates.map((d, i) => (
                          <span key={i}>
                            {i === 0 ? "Fri 7pm " : i === 1 ? "Sat 2pm " : "Sat 7pm "}
                            {d}
                            {i < show.dates.length - 1 ? " · " : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                    <select
                      value={ubusSelected[show.id] || ""}
                      onChange={(e) => setUbusSelected((prev) => ({ ...prev, [show.id]: e.target.value }))}
                      className="border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="">Not attending</option>
                      {show.dates.map((date, i) => (
                        <option key={i} value={`${date} ${i === 0 ? "Fri 7pm" : i === 1 ? "Sat 2pm" : "Sat 7pm"}`}>
                          {i === 0 ? "Fri 7pm" : i === 1 ? "Sat 2pm" : "Sat 7pm"} {date}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Holiday Show */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-2">A La Carte Holiday Show</h2>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-bold">{HOLIDAY_SHOW.name}</div>
                  <div className="text-sm text-gray-500">{HOLIDAY_SHOW.dates}</div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Premium ($60)</label>
                  <input
                    type="number"
                    min="0"
                    value={holidayTickets.premium}
                    onChange={(e) => setHolidayTickets((prev) => ({ ...prev, premium: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Preferred ($55)</label>
                  <input
                    type="number"
                    min="0"
                    value={holidayTickets.preferred}
                    onChange={(e) => setHolidayTickets((prev) => ({ ...prev, preferred: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Student ($40)</label>
                  <input
                    type="number"
                    min="0"
                    value={holidayTickets.student}
                    onChange={(e) => setHolidayTickets((prev) => ({ ...prev, student: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
              </div>
            </div>

            {/* Special Event */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-2">A La Carte Special Event</h2>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-bold">{SPECIAL_EVENT.name}</div>
                  <div className="text-sm text-gray-500">{SPECIAL_EVENT.dates}</div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Premium ($60)</label>
                  <input
                    type="number"
                    min="0"
                    value={specialEventTickets.premium}
                    onChange={(e) => setSpecialEventTickets((prev) => ({ ...prev, premium: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Preferred ($55)</label>
                  <input
                    type="number"
                    min="0"
                    value={specialEventTickets.preferred}
                    onChange={(e) => setSpecialEventTickets((prev) => ({ ...prev, preferred: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Student ($40)</label>
                  <input
                    type="number"
                    min="0"
                    value={specialEventTickets.student}
                    onChange={(e) => setSpecialEventTickets((prev) => ({ ...prev, student: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
              </div>
            </div>

            {/* ACT Shows */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">A La Carte ACT Student Shows</h2>
              
              {ACT_SHOWS.map((show) => (
                <div key={show.id} className="mb-6 last:mb-0">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-bold">{show.name}</div>
                      <div className="text-sm text-gray-500">{show.dates}</div>
                      {show.note && <div className="text-xs text-amber-600">{show.note}</div>}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Premium (${show.price.premium})</label>
                      <input
                        type="number"
                        min="0"
                        value={actTickets[show.id]?.premium || 0}
                        onChange={(e) =>
                          setActTickets((prev) => ({
                            ...prev,
                            [show.id]: { ...prev[show.id], premium: parseInt(e.target.value) || 0 },
                          }))
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Preferred (${show.price.preferred})</label>
                      <input
                        type="number"
                        min="0"
                        value={actTickets[show.id]?.preferred || 0}
                        onChange={(e) =>
                          setActTickets((prev) => ({
                            ...prev,
                            [show.id]: { ...prev[show.id], preferred: parseInt(e.target.value) || 0 },
                          }))
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Student (${show.price.student})</label>
                      <input
                        type="number"
                        min="0"
                        value={actTickets[show.id]?.student || 0}
                        onChange={(e) =>
                          setActTickets((prev) => ({
                            ...prev,
                            [show.id]: { ...prev[show.id], student: parseInt(e.target.value) || 0 },
                          }))
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="py-3 px-6 rounded-lg font-medium text-gray-600 hover:text-gray-900"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700"
              >
                Continue to Seating
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Seating + Contact */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">Step 3: Seating Preferences</h2>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                {SEATING_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSeatingPreference(option.value)}
                    className={`py-3 px-4 rounded-lg border-2 font-medium text-sm transition-colors ${
                      seatingPreference === option.value
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Specific rows/seats (optional)
                </label>
                <input
                  type="text"
                  value={specificSeats}
                  onChange={(e) => setSpecificSeats(e.target.value)}
                  placeholder="e.g., Row C, Seats 12-15"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                />
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">Step 4: Contact Information</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={contact.name}
                    onChange={(e) => setContact((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={contact.address}
                    onChange={(e) => setContact((prev) => ({ ...prev, address: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    value={contact.city}
                    onChange={(e) => setContact((prev) => ({ ...prev, city: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <input
                      type="text"
                      value={contact.state}
                      onChange={(e) => setContact((prev) => ({ ...prev, state: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                    <input
                      type="text"
                      value={contact.zip}
                      onChange={(e) => setContact((prev) => ({ ...prev, zip: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    type="tel"
                    value={contact.phone}
                    onChange={(e) => setContact((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    value={contact.email}
                    onChange={(e) => setContact((prev) => ({ ...prev, email: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="py-3 px-6 rounded-lg font-medium text-gray-600 hover:text-gray-900"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!contact.name || !contact.phone || !contact.email}
                className="bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Review Order
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review + Payment */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">Order Summary</h2>
              
              <div className="space-y-3">
                {subscriberStatus && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span>5-Show Mainstage Season Subscription</span>
                    <span className="font-medium">$200</span>
                  </div>
                )}
                
                {Object.keys(ubusSelected).length > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span>Ubu's Other Shoe Subscription ({Object.keys(ubusSelected).length} shows)</span>
                    <span className="font-medium">$95</span>
                  </div>
                )}
                
                {(holidayTickets.premium + holidayTickets.preferred + holidayTickets.student) > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span>Million Dollar Quartet Christmas</span>
                    <span className="font-medium">
                      ${holidayTickets.premium * 60 + holidayTickets.preferred * 55 + holidayTickets.student * 40}
                    </span>
                  </div>
                )}
                
                {(specialEventTickets.premium + specialEventTickets.preferred + specialEventTickets.student) > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span>Forever Plaid</span>
                    <span className="font-medium">
                      ${specialEventTickets.premium * 60 + specialEventTickets.preferred * 55 + specialEventTickets.student * 40}
                    </span>
                  </div>
                )}
                
                {Object.entries(actTickets).map(([showId, tickets]) => {
                  const show = ACT_SHOWS.find((s) => s.id === showId);
                  const total = tickets.premium * show!.price.premium + tickets.preferred * show!.price.preferred + tickets.student * show!.price.student;
                  return total > 0 ? (
                    <div key={showId} className="flex justify-between py-2 border-b border-gray-100">
                      <span>{show!.name}</span>
                      <span className="font-medium">${total}</span>
                    </div>
                  ) : null;
                })}
                
                <div className="flex justify-between py-2 border-b border-gray-100">
                  <span>Ticketing/Handling Fee</span>
                  <span className="font-medium">$10</span>
                </div>
                
                {(donation.annualFund + donation.act + donation.capitalCampaign) > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span>Donations</span>
                    <span className="font-medium">${donation.annualFund + donation.act + donation.capitalCampaign}</span>
                  </div>
                )}
                
                <div className="flex justify-between py-3 text-lg font-bold">
                  <span>Total</span>
                  <span className="text-blue-600">${calculateTotal()}</span>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">Payment Method</h2>
              
              <div className="flex gap-4 mb-6">
                <button
                  onClick={() => setPaymentMethod("credit")}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                    paymentMethod === "credit"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  Credit Card
                </button>
                <button
                  onClick={() => setPaymentMethod("check")}
                  className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                    paymentMethod === "check"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  Check
                </button>
              </div>
              
              {paymentMethod === "credit" && (
                <div className="text-sm text-gray-600 bg-gray-50 rounded p-4">
                  You will receive a secure payment link via email to complete your transaction.
                </div>
              )}
              
              {paymentMethod === "check" && (
                <div className="text-sm text-gray-600 bg-gray-50 rounded p-4">
                  Please make check payable to: <strong>SLO REP</strong><br />
                  Mail to: SLO REP, PO Box 122, San Luis Obispo, CA 93406
                </div>
              )}
            </div>

            {/* Donations */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">Optional Donations</h2>
              <p className="text-sm text-gray-500 mb-4">SLO REP is a 501(c)3 non-profit. All donations are tax-deductible.</p>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Annual Fund</label>
                  <input
                    type="number"
                    min="0"
                    value={donation.annualFund}
                    onChange={(e) => setDonation((prev) => ({ ...prev, annualFund: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ACT Program</label>
                  <input
                    type="number"
                    min="0"
                    value={donation.act}
                    onChange={(e) => setDonation((prev) => ({ ...prev, act: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Capital Campaign</label>
                  <input
                    type="number"
                    min="0"
                    value={donation.capitalCampaign}
                    onChange={(e) => setDonation((prev) => ({ ...prev, capitalCampaign: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(3)}
                className="py-3 px-6 rounded-lg font-medium text-gray-600 hover:text-gray-900"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={!paymentMethod}
                className="bg-blue-600 text-white py-3 px-8 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Order — ${calculateTotal()}
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 px-6 py-4 mt-8">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          <p>SLO REP · 888 Morro Street, San Luis Obispo · (805) 786-2440 · boxoffice@slorep.org</p>
          <p className="mt-1">Federal Tax ID #95-2556678 · 501(c)3 Non-Profit</p>
        </div>
      </footer>
    </div>
  );
}
