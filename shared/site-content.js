import { packages, reportContent } from './catalog.js';

export const pageNames = {
  '/': 'Home', '/pricing': 'Report options', '/checkout': 'Checkout', '/confirmation': 'Order status',
  '/about': 'About', '/contact': 'Support', '/privacy': 'Privacy', '/terms': 'Terms', '/refunds': 'Refunds',
};
const email = 'carvexo.co.uk@gmail.com';
export const defaults = {
  packages: packages.map((item, index) => ({ ...item, enabled: true, position: index })),
  payment: { provider: '', demoEnabled: true },
  notifications: { ownerEmail: email, replyTo: email },
  content: {
    ...Object.fromEntries(['turnaround', 'businessName', 'businessAddress', 'reviews', 'privacy', 'terms', 'refunds'].map(key => [key, reportContent[key]])),
    supportEmail: '', phone: '', socials: [],
    home: {
      eyebrow: 'UK vehicle history reports', heading: 'Know the car', accent: 'before you buy it.',
      intro: 'Enter a UK registration number to order a vehicle history report, delivered by email.',
      registrationLabel: 'Vehicle registration number', registrationButton: 'View report options',
      coverageEyebrow: 'Report coverage', coverageHeading: 'Look beneath the surface.',
      coverageIntro: 'A vehicle history report helps you put the seller’s description in context and know what to ask before you buy.',
      coverageNote: 'Available records vary by vehicle and report package.',
      coverageTopics: [
        ['Vehicle identity', 'Compare recorded vehicle details with the seller’s description.'],
        ['Recorded mileage', 'Spot mileage changes that may be worth asking the seller about.'],
        ['Reported history', 'Review available records that could affect your decision.'],
      ],
      sampleEyebrow: 'Sample report', sampleHeading: 'Read the history in order.',
      sampleIntro: 'A dated timeline makes it easier to see how the available records fit together.',
      howEyebrow: 'How it works', howHeading: 'From plate to report.', howButton: 'Check a vehicle',
      howSteps: [
        ['Enter a registration', 'Use the number from the vehicle’s UK registration plate.'],
        ['Choose a report', 'Select a one-off package.'],
        ['Receive it by email', 'After payment, our team prepares the report and sends it to the email you entered at checkout.'],
      ],
      whyEyebrow: 'Why Carvexo', whyHeading: 'Make your next conversation with the seller count.',
      whyButton: 'About Carvexo',
      whyPoints: ['Start with a UK registration.', 'Choose a one-off report.', 'Receive it directly by email.'],
      servicesHeading: 'Services', reviewsEyebrow: 'Customer reviews', reviewsHeading: 'What buyers say.',
      reviewsEmpty: 'Customer reviews will appear here once available.',
      faqEyebrow: 'Questions', faqHeading: 'Good to know.', faqButton: 'Contact support',
      footerText: 'UK vehicle history reports.\nPrepared by the Carvexo team.',
    },
    services: [
      ['Basic vehicle history report', 'Order a one-off report for a vehicle you’re considering.'],
      ['Full vehicle history report', 'Compare the two report packages for your registration before choosing.'],
      ['Report delivery by email', 'Our team prepares your report and sends it to the address you enter at checkout.'],
    ],
    faqs: [
      ['What is a vehicle history report?', 'It brings together available records for a vehicle so you can compare its history with what you have been told and follow up on anything unclear.'],
      ['Which registration number should I enter?', 'Use the registration number from the vehicle’s UK number plate. You can enter it with or without spaces. If you are unsure, confirm the registration with the seller before placing an order.'],
      ['What is included in each package?', 'Enter the registration to see the checks included in each report package.'],
      ['When will my report arrive?', 'Our team prepares the report after payment and emails it to the address you provide at checkout.'],
      ['Does a report show every event?', 'Reports cover the records available for the vehicle. An empty section does not establish that an incident did not happen. Check the original paperwork and use an independent inspection where appropriate.'],
      ['What if I enter the wrong email address?', 'Contact Carvexo with your order reference and the correct email address so the team can help.'],
    ],
    info: {
      about: { title: 'A clearer view of a used car.', body: [
        'Carvexo helps buyers ask better questions before agreeing to buy a used vehicle. Enter its UK registration, choose a report, and our team sends the report to the email address you provide.',
        'Records vary by vehicle and by the information that has been reported. Read the report alongside the seller’s documents and raise anything unexpected before making a decision.',
      ] },
      contact: { title: 'How can we help?', body: ['If you’re contacting us about an order, have your order reference and vehicle registration handy.'] },
      privacy: { title: 'Privacy notice' }, terms: { title: 'Terms of service' }, refunds: { title: 'Refund information' },
    },
    seo: Object.fromEntries(Object.entries(pageNames).map(([path, title]) => [path, {
      title: path === '/' ? 'Carvexo — UK Vehicle History Reports' : title + ' — Carvexo',
      description: path === '/' ? 'Order a UK vehicle history report from Carvexo using the registration number. Choose a report and receive it by email.' : '',
      keywords: '',
    }])),
  },
};
