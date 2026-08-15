#!/usr/bin/env python3
"""Generate the demo dataset for TEAL LeadConnect.

Deterministic (fixed seed) so the app looks the same on every machine and the
test suite can assert exact counts. The company and contact names are
synthetic but plausible for the Indian electronics / advanced-manufacturing
belt TEAL actually sells into — no "ABC Corp", no "John Doe" (§44).
"""
import json, os, random, datetime as dt

random.seed(20260815)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
os.makedirs(OUT, exist_ok=True)

TODAY = dt.date(2026, 8, 15)


def iso(d, h=10, m=0):
    return dt.datetime(d.year, d.month, d.day, h, m).isoformat(timespec='seconds')


# ---------------------------------------------------------------- reference
PRODUCTS = [
    ('P-LM-01', 'Laser Marking',                'LASER',      'Marking & Traceability'),
    ('P-LW-02', 'Laser Welding',                'LASER',      'Joining'),
    ('P-LC-03', 'Laser Cutting',                'LASER',      'Cutting'),
    ('P-PL-04', 'PCB Laser Marking',            'LASER',      'Electronics'),
    ('P-CO-05', 'CO₂ Laser PCB Marking',        'LASER',      'Electronics'),
    ('P-UV-06', 'UV Laser Marking',             'LASER',      'Electronics'),
    ('P-FL-07', 'Fiber Laser Marking',          'LASER',      'Marking & Traceability'),
    ('P-3D-08', '3D Laser Marking',             'LASER',      'Marking & Traceability'),
    ('P-BT-09', 'Battery Laser Applications',   'LASER',      'New Energy'),
    ('P-SC-10', 'Semiconductor Laser Applications', 'LASER',  'Semiconductor'),
    ('P-CU-11', 'Custom Laser Application',     'LASER',      'Engineered'),
    ('P-VI-12', 'Vision Inspection',            'AUTOMATION', 'Inspection'),
    ('P-RO-13', 'Robotic Automation',           'AUTOMATION', 'Handling'),
    ('P-PR-14', 'Precision Automation',         'AUTOMATION', 'Assembly'),
    ('P-SP-15', 'Special Purpose Machines',     'AUTOMATION', 'Engineered'),
    ('P-AS-16', 'Assembly Automation',          'AUTOMATION', 'Assembly'),
    ('P-TE-17', 'Testing Automation',           'AUTOMATION', 'Test'),
    ('P-CA-18', 'Custom Automation',            'AUTOMATION', 'Engineered'),
]

INDUSTRIES = ['Semiconductor', 'EMS', 'Electronics', 'Automotive', 'Battery / EV',
              'Solar', 'Industrial Automation', 'Precision Engineering',
              'Aerospace', 'Medical Devices']

CITIES = [('Bengaluru', 'Karnataka'), ('Chennai', 'Tamil Nadu'), ('Pune', 'Maharashtra'),
          ('Hyderabad', 'Telangana'), ('Noida', 'Uttar Pradesh'), ('Gurugram', 'Haryana'),
          ('Ahmedabad', 'Gujarat'), ('Coimbatore', 'Tamil Nadu'), ('Hosur', 'Tamil Nadu'),
          ('Sanand', 'Gujarat'), ('Manesar', 'Haryana'), ('Nashik', 'Maharashtra'),
          ('Sriperumbudur', 'Tamil Nadu'), ('Chakan', 'Maharashtra'), ('Mysuru', 'Karnataka')]

COMPANY_STEMS = [
    ('Vertex Microsystems', 'Semiconductor'), ('Kaveri Electronics', 'EMS'),
    ('Sundaram Precision Works', 'Precision Engineering'), ('Nucleon Semiconductors', 'Semiconductor'),
    ('Amperex Energy Systems', 'Battery / EV'), ('Deccan Circuits', 'EMS'),
    ('Helios Solar Technologies', 'Solar'), ('Rathore Autocomp', 'Automotive'),
    ('Meridian Medical Devices', 'Medical Devices'), ('Zenith Aerostructures', 'Aerospace'),
    ('Chola Micro Assemblies', 'EMS'), ('Krishna Toolings', 'Precision Engineering'),
    ('Voltcore Battery Labs', 'Battery / EV'), ('Nilgiri Optoelectronics', 'Electronics'),
    ('Bharat Drive Systems', 'Automotive'), ('Sagar Semicon Foundry', 'Semiconductor'),
    ('Pinnacle EMS Solutions', 'EMS'), ('Godavari Powertrain', 'Battery / EV'),
    ('Arya Instrumentation', 'Industrial Automation'), ('Tejas Photonics', 'Electronics'),
    ('Konark Renewables', 'Solar'), ('Vidyut Mobility', 'Battery / EV'),
    ('Saraswati Microtech', 'Semiconductor'), ('Anand Contract Manufacturing', 'EMS'),
    ('Orion Metrology', 'Precision Engineering'), ('Bhaskar Aerospace Components', 'Aerospace'),
    ('Nandi Electric Vehicles', 'Automotive'), ('Ganga Medical Systems', 'Medical Devices'),
    ('Prithvi Industrial Robotics', 'Industrial Automation'), ('Surya Cell Technologies', 'Solar'),
]
SUFFIX = ['Pvt Ltd', 'Limited', 'India Pvt Ltd', 'Technologies Pvt Ltd', 'Industries Ltd']

# Account type follows the industry — an EMS house is not an OEM, and a
# semiconductor fab is not a system integrator.
ACCOUNT_TYPE_BY_INDUSTRY = {
    'Semiconductor':         ['OEM', 'Contract Manufacturer', 'Research Institute'],
    'EMS':                   ['EMS', 'Contract Manufacturer'],
    'Electronics':           ['OEM', 'EMS', 'Tier 1 Supplier'],
    'Automotive':            ['OEM', 'Tier 1 Supplier'],
    'Battery / EV':          ['OEM', 'Tier 1 Supplier', 'Contract Manufacturer'],
    'Solar':                 ['OEM', 'Contract Manufacturer'],
    'Industrial Automation': ['System Integrator', 'OEM'],
    'Precision Engineering': ['Tier 1 Supplier', 'Contract Manufacturer'],
    'Aerospace':             ['Tier 1 Supplier', 'OEM'],
    'Medical Devices':       ['OEM', 'Contract Manufacturer'],
}

FIRST = ['Rajesh', 'Priya', 'Anil', 'Meera', 'Suresh', 'Kavita', 'Arun', 'Deepa', 'Vikram',
         'Sneha', 'Ramesh', 'Ananya', 'Karthik', 'Divya', 'Manoj', 'Lakshmi', 'Sanjay',
         'Nisha', 'Vivek', 'Pooja', 'Harish', 'Rekha', 'Ashok', 'Swati', 'Girish', 'Aarti',
         'Naveen', 'Shalini', 'Prakash', 'Bhavana', 'Rohit', 'Madhuri']
LAST = ['Kumar', 'Sharma', 'Iyer', 'Reddy', 'Patel', 'Nair', 'Menon', 'Deshpande', 'Rao',
        'Bhat', 'Chauhan', 'Joshi', 'Pillai', 'Sethi', 'Gowda', 'Varma', 'Kulkarni',
        'Mehta', 'Subramanian', 'Banerjee', 'Shetty', 'Trivedi']

DESIGNATIONS = [
    ('Head of Manufacturing', 'Decision Maker'), ('VP Operations', 'Decision Maker'),
    ('Plant Head', 'Decision Maker'), ('Managing Director', 'Decision Maker'),
    ('Senior Manager - Production', 'Influencer'), ('Manager - Process Engineering', 'Influencer'),
    ('Lead Process Engineer', 'Influencer'), ('Automation Manager', 'Influencer'),
    ('Quality Head', 'Influencer'), ('R&D Manager', 'Influencer'),
    ('Production Engineer', 'End User'), ('Maintenance Engineer', 'End User'),
    ('Purchase Manager', 'Gatekeeper'), ('Sourcing Lead', 'Gatekeeper'),
]

APPLICATIONS_BY_INDUSTRY = {
    'Semiconductor': ['Wafer ID marking, backside', 'Lead frame cutting for IC packaging',
                      'Permanent traceability marking on power modules'],
    'EMS': ['PCB serialisation with 2D data matrix', 'Automated optical inspection on SMT line',
            'Robotic pick-and-place for connector assembly', 'End-of-line functional test automation'],
    'Electronics': ['PCB serialisation with 2D data matrix', 'Sensor housing hermetic seal welding',
                    'Automated optical inspection on SMT line'],
    'Automotive': ['Motor stator hairpin welding', 'Deburring and surface texturing of press parts',
                   'End-of-line functional test automation'],
    'Battery / EV': ['Busbar welding for EV battery packs', 'Cell tab welding, prismatic format',
                     'Motor stator hairpin welding'],
    'Solar': ['Solar cell stringing and interconnect', 'Automated optical inspection on SMT line'],
    'Industrial Automation': ['Robotic pick-and-place for connector assembly',
                              'End-of-line functional test automation',
                              'Deburring and surface texturing of press parts'],
    'Precision Engineering': ['Precision fixture assembly for aerospace brackets',
                              'Deburring and surface texturing of press parts',
                              'Permanent traceability marking on power modules'],
    'Aerospace': ['Precision fixture assembly for aerospace brackets',
                  'Sensor housing hermetic seal welding'],
    'Medical Devices': ['Medical implant marking, UDI compliance',
                        'Sensor housing hermetic seal welding'],
}

APPLICATIONS = [
    'Permanent traceability marking on power modules',
    'Busbar welding for EV battery packs',
    'Cell tab welding, prismatic format',
    'PCB serialisation with 2D data matrix',
    'Wafer ID marking, backside',
    'Lead frame cutting for IC packaging',
    'Solar cell stringing and interconnect',
    'Sensor housing hermetic seal welding',
    'Automated optical inspection on SMT line',
    'Robotic pick-and-place for connector assembly',
    'End-of-line functional test automation',
    'Precision fixture assembly for aerospace brackets',
    'Medical implant marking, UDI compliance',
    'Motor stator hairpin welding',
    'Deburring and surface texturing of press parts',
]

PROBLEMS = [
    'Existing dot-peen marking fails legibility audit at customer end.',
    'Manual welding yields inconsistent penetration; scrap running at 4%.',
    'Current supplier lead time is 26 weeks and blocking a line expansion.',
    'Vision system misses solder bridging below 0.2 mm.',
    'Line changeover takes 45 minutes against a 15-minute target.',
    'Operator-dependent quality variation across three shifts.',
    'Traceability gap flagged in the last automotive customer audit.',
    'Throughput capped at 380 parts/hour against a 600 requirement.',
    'Thermal damage on adjacent components with the incumbent process.',
    'Cannot mark the new substrate material with the existing laser.',
]

COMPETITORS = ['Trumpf', 'Han\'s Laser', 'Coherent', 'IPG Photonics', 'Keyence',
               'Bystronic', 'Incumbent in-house build', 'None identified']

STAGES = ['NEW', 'QUALIFIED', 'ENGAGED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']
TIMELINES = ['Immediate', '< 3 Months', '3-6 Months', '6-12 Months', '> 12 Months', 'Not Defined']
BUDGETS = ['Not Defined', '< ₹25 L', '₹25 L – ₹75 L', '₹75 L – ₹2 Cr', '₹2 Cr – ₹5 Cr', '> ₹5 Cr']
SOURCES = ['Booth Conversation', 'Badge Scan', 'Business Card', 'Visitor QR', 'Referral', 'Demo Station']

NBA_BY_STAGE = {
    'NEW':         ('Qualify the requirement', 'Confirm application, volume and timeline before the trail goes cold.'),
    'QUALIFIED':   ('Schedule technical discussion', 'Bring an application engineer to scope the process window.'),
    'ENGAGED':     ('Arrange machine demo', 'Run their sample part on the target platform.'),
    'DEMO':        ('Send capability deck and sample report', 'Convert the demo result into a written case.'),
    'PROPOSAL':    ('Follow up on proposal', 'Confirm receipt, walk the commercials, agree next step.'),
    'NEGOTIATION': ('Close commercial terms', 'Align on price, delivery and payment milestones.'),
    'WON':         ('Hand over to project execution', 'Brief the delivery team and confirm the kickoff date.'),
    'LOST':        ('Log the loss reason', 'Capture why, and set a re-engagement date.'),
}

# ---------------------------------------------------------------- users
USERS = [
    dict(id='u-admin',  name='Jatin Songara',     email='jatin.songara@teal.example',
         role='admin',      title='Platform Administrator', region='All India', active=True),
    dict(id='u-priya',  name='Priya Raman',       email='priya.raman@teal.example',
         role='sales',      title='Regional Sales Manager — South', region='South', active=True),
    dict(id='u-arun',   name='Arun Menon',        email='arun.menon@teal.example',
         role='sales',      title='Sales Manager — West', region='West', active=True),
    dict(id='u-sneha',  name='Sneha Kulkarni',    email='sneha.kulkarni@teal.example',
         role='sales',      title='Application Engineer — Laser', region='North', active=True),
    dict(id='u-kavita', name='Kavita Deshpande',  email='kavita.deshpande@teal.example',
         role='management', title='Head of Sales', region='All India', active=True),
]
SALES = [u['id'] for u in USERS if u['role'] == 'sales']

# ---------------------------------------------------------------- exhibitions
EXHIBITIONS = [
    dict(id='ex-prod26', code='PROD26', name='Productronica India 2026', city='Bengaluru',
         venue='BIEC, Bengaluru', start='2026-08-12', end='2026-08-14',
         active=True, visitors=18400, boothCost=4200000,
         focus=['Electronics', 'Semiconductor', 'EMS']),
    dict(id='ex-imtex26', code='IMTEX26', name='IMTEX 2026', city='Bengaluru',
         venue='BIEC, Bengaluru', start='2026-01-22', end='2026-01-27',
         active=False, visitors=32000, boothCost=5600000,
         focus=['Precision Engineering', 'Automotive', 'Aerospace']),
    dict(id='ex-batshow25', code='BAT25', name='Battery Show India 2025', city='New Delhi',
         venue='Yashobhoomi, Dwarka', start='2025-11-05', end='2025-11-07',
         active=False, visitors=11200, boothCost=2800000,
         focus=['Battery / EV', 'New Energy']),
]

# ---------------------------------------------------------------- companies
companies, contacts, leads, activities = [], [], [], []

used_names = set()
for i, (stem, industry) in enumerate(COMPANY_STEMS):
    city, state = CITIES[i % len(CITIES)]
    name = f'{stem} {SUFFIX[i % len(SUFFIX)]}'
    used_names.add(name)
    slug = stem.lower().replace(' ', '').replace("'", '')[:14]
    size = random.choice(['50-200', '200-1000', '1000-5000', '5000+'])
    companies.append(dict(
        id=f'co-{i+1:03d}', name=name, industry=industry,
        size=size, city=city, state=state, country='India',
        website=f'www.{slug}.co.in',
        accountType=random.choice(ACCOUNT_TYPE_BY_INDUSTRY[industry]),
        segment=random.choice(['Enterprise', 'Mid-market', 'Growth']),
    ))

# ---------------------------------------------------------------- leads
# Capture depth. A real booth produces mostly thin records: a name, a company
# and maybe a product. Only a minority get fully qualified in the aisle, and
# that is what the score is supposed to separate. Mixing these deliberately is
# what stops every demo lead reading "Hot".
#   thin      — badge scan or a passing conversation
#   partial   — a real conversation, some qualification missing
#   qualified — application, timeline and authority captured
#   deep      — fully worked, budget and commercial discussion included
DEPTHS = (['thin'] * 34 + ['partial'] * 30 + ['qualified'] * 25 + ['deep'] * 11)


def make_lead(n, exhibition, stage, owner, depth, is_active_event):
    co = companies[n % len(companies)]
    fn, ln = random.choice(FIRST), random.choice(LAST)

    # Seniority tracks depth: you rarely pin down a decision maker in 90 seconds.
    if depth == 'thin':
        desig, authority = random.choice(
            [d for d in DESIGNATIONS if d[1] in ('End User', 'Gatekeeper', 'Influencer')])
        if random.random() < 0.55:
            authority = 'Unknown'
    elif depth == 'partial':
        desig, authority = random.choice(DESIGNATIONS)
    else:
        desig, authority = random.choice(
            [d for d in DESIGNATIONS if d[1] in ('Decision Maker', 'Influencer')])

    dom = co['website'].replace('www.', '')
    contact_id = f'ct-{n+1:03d}'

    # Product interest widens with depth.
    n_products = {'thin': random.choice([0, 1, 1]), 'partial': random.choice([1, 1, 2]),
                  'qualified': random.choice([1, 2, 2]), 'deep': random.choice([2, 3])}[depth]
    prods = random.sample(PRODUCTS, n_products) if n_products else []

    application = ('' if depth == 'thin' and random.random() < 0.75
                   else random.choice(APPLICATIONS_BY_INDUSTRY[co['industry']]))
    problem = '' if depth in ('thin', 'partial') and random.random() < 0.6 else random.choice(PROBLEMS)

    if depth == 'thin':
        timeline = random.choice(['Not Defined', 'Not Defined', 'Not Defined', '> 12 Months', '6-12 Months'])
        budget = 'Not Defined'
    elif depth == 'partial':
        timeline = random.choice(['Not Defined', '6-12 Months', '3-6 Months', '3-6 Months'])
        budget = random.choice(['Not Defined', 'Not Defined', '< ₹25 L', '₹25 L – ₹75 L'])
    elif depth == 'qualified':
        timeline = random.choice(['3-6 Months', '< 3 Months', '< 3 Months', 'Immediate'])
        budget = random.choice(['₹25 L – ₹75 L', '₹75 L – ₹2 Cr', 'Not Defined'])
    else:
        timeline = random.choice(['Immediate', '< 3 Months'])
        budget = random.choice(['₹75 L – ₹2 Cr', '₹2 Cr – ₹5 Cr', '> ₹5 Cr'])

    contacts.append(dict(
        id=contact_id, companyId=co['id'],
        name=f'{fn} {ln}', designation=desig, authority=authority,
        email=f'{fn.lower()}.{ln.lower()}@{dom}',
        phone=f'+91 {random.randint(70,99)}{random.randint(100,999)} {random.randint(10000,99999)}',
        linkedin=f'linkedin.com/in/{fn.lower()}-{ln.lower()}-{random.randint(10,99)}',
        city=co['city'], country='India',
    ))

    s = dt.date.fromisoformat(exhibition['start'])
    e = dt.date.fromisoformat(exhibition['end'])
    captured = s + dt.timedelta(days=random.randint(0, (e - s).days))

    value = 0
    if stage not in ('NEW',) and depth != 'thin':
        value = random.choice([1800000, 2400000, 3600000, 5200000, 7500000,
                               9800000, 12500000, 18000000, 24000000])

    engagement = {
        'booth': True,
        'meeting': depth in ('qualified', 'deep') or stage in ('ENGAGED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON'),
        'technical': depth in ('qualified', 'deep') and stage not in ('NEW',),
        'demo': depth == 'deep' or stage in ('DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON'),
        'commercial': stage in ('PROPOSAL', 'NEGOTIATION', 'WON'),
    }

    lead_id = f'ld-{n+1:03d}'
    code = f"TEAL-{exhibition['code']}-{n+1:05d}"

    # Follow-up dates only make sense while an opportunity is open. Closed
    # leads carry none, and leads from an event months ago have already been
    # worked — so the Follow-up Center shows a live queue, not a wall of red.
    if stage in ('WON', 'LOST'):
        next_fu = ''
    elif is_active_event:
        offset = {'NEW': 1, 'QUALIFIED': 2, 'ENGAGED': 4, 'DEMO': 5,
                  'PROPOSAL': 7, 'NEGOTIATION': 3}[stage]
        next_fu = (TODAY + dt.timedelta(days=random.randint(-3, offset))).isoformat()
    else:
        next_fu = (TODAY + dt.timedelta(days=random.randint(3, 45))).isoformat()

    nba_title, nba_why = NBA_BY_STAGE[stage]

    tag_pool = ['Demo requested', 'RFQ expected', 'Technical deep-dive',
                'Pricing discussed', 'Urgent', 'Repeat customer', 'Competitor displacement']
    n_tags = {'thin': 0, 'partial': random.choice([0, 1]),
              'qualified': random.choice([1, 2]), 'deep': random.choice([2, 3])}[depth]

    return dict(
        id=lead_id, code=code, contactId=contact_id, companyId=co['id'],
        exhibitionId=exhibition['id'], ownerId=owner, stage=stage,
        products=[p[1] for p in prods], productIds=[p[0] for p in prods],
        application=application, problem=problem,
        quantity='' if depth == 'thin' else random.choice(
            ['1 machine', '2 machines', '1 line', '3 stations', 'Pilot + 4 production',
             'Under evaluation']),
        budget=budget, timeline=timeline, authority=authority,
        currentSolution='' if depth == 'thin' else random.choice(
            ['Manual process', 'In-house build', 'Competitor machine',
             'Outsourced to job shop', 'Greenfield — none']),
        competitor=random.choice(COMPETITORS) if depth in ('qualified', 'deep') else 'None identified',
        value=value, source=random.choice(SOURCES),
        engagement=engagement,
        capturedAt=iso(captured, random.randint(10, 17), random.choice([0, 15, 30, 45])),
        nextFollowUp=next_fu,
        nextBestAction=nba_title, nextBestActionWhy=nba_why,
        consent=True,
        tags=random.sample(tag_pool, n_tags),
        notes='' if depth == 'thin' and random.random() < 0.6 else random.choice([
            'Walked the booth with two colleagues from process engineering.',
            'Already evaluating alternatives; wants a sample part run before deciding.',
            'Budget sits with the parent group; approval cycle is roughly a quarter.',
            'Asked specifically about cycle time and consumable cost per part.',
            'Site visit to their plant offered — they are keen.',
            'Follow-up should route through their purchase team.',
        ]),
    )


# The live event is mostly raw capture; older events have had time to work
# through the pipeline and to lose deals.
FRESH_MIX  = ['NEW'] * 14 + ['QUALIFIED'] * 9 + ['ENGAGED'] * 6 + ['DEMO'] * 3 + ['PROPOSAL'] * 2
MATURE_MIX = (['QUALIFIED'] * 3 + ['ENGAGED'] * 4 + ['DEMO'] * 4 + ['PROPOSAL'] * 4 +
              ['NEGOTIATION'] * 3 + ['WON'] * 4 + ['LOST'] * 8)

n = 0
for ex, count, fresh in ((EXHIBITIONS[0], 34, True), (EXHIBITIONS[1], 18, False),
                         (EXHIBITIONS[2], 12, False)):
    mix = FRESH_MIX if fresh else MATURE_MIX
    for k in range(count):
        stage = mix[(n * 5 + k * 3) % len(mix)]
        depth = DEPTHS[(n * 7 + k) % len(DEPTHS)]
        # A deal that reached proposal was necessarily qualified along the way.
        if stage in ('PROPOSAL', 'NEGOTIATION', 'WON') and depth in ('thin', 'partial'):
            depth = 'qualified'
        if stage == 'NEW' and depth in ('qualified', 'deep'):
            depth = 'partial'
        owner = SALES[n % len(SALES)]
        leads.append(make_lead(n, ex, stage, owner, depth, fresh))
        n += 1

# ---------------------------------------------------------------- activities
ACT_FOR_STAGE = {
    'NEW':         ['lead_captured'],
    'QUALIFIED':   ['lead_captured', 'call', 'stage_change'],
    'ENGAGED':     ['lead_captured', 'call', 'meeting', 'technical', 'stage_change'],
    'DEMO':        ['lead_captured', 'call', 'meeting', 'technical', 'demo', 'stage_change'],
    'PROPOSAL':    ['lead_captured', 'call', 'meeting', 'demo', 'quotation', 'stage_change'],
    'NEGOTIATION': ['lead_captured', 'meeting', 'demo', 'quotation', 'call', 'stage_change'],
    'WON':         ['lead_captured', 'meeting', 'demo', 'quotation', 'stage_change', 'won'],
    'LOST':        ['lead_captured', 'call', 'quotation', 'lost'],
}
ACT_TEXT = {
    'lead_captured': ('Lead captured at booth', 'Captured on the stand and scored automatically.'),
    'call':          ('Follow-up call', 'Discussed the requirement and confirmed the next step.'),
    'meeting':       ('Meeting held', 'Reviewed the application in detail with their engineering team.'),
    'technical':     ('Technical discussion', 'Process window, fixturing and cycle time reviewed.'),
    'demo':          ('Machine demo completed', 'Sample parts run on the target platform; results shared.'),
    'quotation':     ('Quotation issued', 'Commercial proposal sent with delivery schedule.'),
    'stage_change':  ('Pipeline stage advanced', 'Moved forward after the last interaction.'),
    'won':           ('Opportunity won', 'Purchase order received; handed to project execution.'),
    'lost':          ('Opportunity lost', 'Customer proceeded with an alternative supplier.'),
}
a = 0
for ld in leads:
    base = dt.date.fromisoformat(ld['capturedAt'][:10])
    for j, kind in enumerate(ACT_FOR_STAGE[ld['stage']]):
        a += 1
        title, body = ACT_TEXT[kind]
        activities.append(dict(
            id=f'ac-{a:04d}', leadId=ld['id'], companyId=ld['companyId'],
            type=kind, title=title, body=body,
            actorId=ld['ownerId'],
            at=iso(base + dt.timedelta(days=j * 2), 11 + (j % 6), 0),
        ))

# ---------------------------------------------------------------- notifications
notifications = []
hot_sample = [l for l in leads if l['stage'] in ('PROPOSAL', 'NEGOTIATION')][:4]
overdue = [l for l in leads if l['nextFollowUp']
           and l['nextFollowUp'] < TODAY.isoformat()
           and l['stage'] not in ('WON', 'LOST')][:5]
for i, l in enumerate(hot_sample):
    co = next(c for c in companies if c['id'] == l['companyId'])
    notifications.append(dict(
        id=f'nt-{i+1:03d}', severity='high', type='high_value',
        title='High-value opportunity needs attention',
        body=f"{co['name']} — {l['products'][0]} at ₹{l['value']/10000000:.2f} Cr is sitting in {l['stage'].title()}.",
        leadId=l['id'], at=iso(TODAY - dt.timedelta(days=i), 9, 15), read=False))
for i, l in enumerate(overdue):
    co = next(c for c in companies if c['id'] == l['companyId'])
    notifications.append(dict(
        id=f'nt-{100+i:03d}', severity='critical', type='overdue',
        title='Follow-up overdue',
        body=f"{co['name']} was due for {l['nextBestAction'].lower()} on {l['nextFollowUp']}.",
        leadId=l['id'], at=iso(TODAY - dt.timedelta(days=i), 8, 0), read=False))
notifications.append(dict(
    id='nt-200', severity='info', type='digest',
    title='Productronica India 2026 has closed',
    body='34 leads captured over three days. The exhibition report is ready to review.',
    leadId=None, at=iso(TODAY, 7, 30), read=True))

# ---------------------------------------------------------------- settings
settings = dict(
    product=dict(
        parentBrand='TEAL', productName='LeadConnect',
        descriptor='Exhibition Lead Intelligence & Sales Conversion OS',
        promise='Turn Every Exhibition Lead Into a Sales Opportunity.',
    ),
    scoring=dict(
        # §14 — the published weights. They sum to 100.
        weights=[
            dict(key='companyFit',      label='Company Fit',        max=20,
                 why='Industry, size and account type against TEAL\'s served segments.'),
            dict(key='applicationFit',  label='Application Fit',    max=20,
                 why='Whether the stated application maps to a proven TEAL process.'),
            dict(key='productInterest', label='Product Interest',   max=15,
                 why='Named products the visitor asked about.'),
            dict(key='timeline',        label='Purchase Timeline',  max=15,
                 why='How soon the requirement lands.'),
            dict(key='budget',          label='Budget',             max=10,
                 why='Whether a budget band has been stated.'),
            dict(key='authority',       label='Decision Authority', max=10,
                 why='Seniority of the contact against the buying decision.'),
            dict(key='engagement',      label='Engagement',         max=10,
                 why='Demo, meeting and technical depth reached at the stand.'),
        ],
        bands=[
            dict(key='COLD',      label='Cold',      min=0,  max=39),
            dict(key='WARM',      label='Warm',      min=40, max=69),
            dict(key='HOT',       label='Hot',       min=70, max=84),
            dict(key='STRATEGIC', label='Strategic', min=85, max=100),
        ],
    ),
    reference=dict(
        industries=INDUSTRIES, stages=STAGES, timelines=TIMELINES, budgets=BUDGETS,
        sources=SOURCES, cities=[c[0] for c in CITIES],
        authorities=['Decision Maker', 'Influencer', 'End User', 'Gatekeeper', 'Unknown'],
    ),
)

# ---------------------------------------------------------------- write
def write(name, payload):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f'{name:22s} {len(payload) if isinstance(payload, list) else 1:>4}')


write('users.json', USERS)
write('exhibitions.json', EXHIBITIONS)
write('products.json', [dict(id=p[0], name=p[1], category=p[2], family=p[3]) for p in PRODUCTS])
write('companies.json', companies)
write('contacts.json', contacts)
write('leads.json', leads)
write('activities.json', activities)
write('notifications.json', notifications)
write('settings.json', settings)
