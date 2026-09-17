"""
Synthetic Call Data Generator (Sanitized Portfolio Edition)
Synthesizes realistic, anonymized speech analytics datasets conforming strictly to the
15-column canonical schema. Simulates contact center incident dynamics with zero PII
and zero proprietary branding.
"""

import argparse
import csv
from datetime import datetime, timedelta
import random

REQUIRED_COLUMNS = [
    'Timestamp',
    'Contact_ID',
    'Agent_ID',
    'Queue_Name',
    'Call_Duration (s)',
    'Silence_Duration (s)',
    'Silence_Pct',
    'Max_Agitation_Score',
    'Primary_Category',
    'Customer_Sentiment',
    'Agent_Quality',
    'Compliance_Risk',
    'Empathy_Score',
    'FCR_Flag',
    'Call_Summary_Transcript',
]

AGENTS = [
    'AGENT_ALEX',
    'AGENT_JORDAN',
    'AGENT_TAYLOR',
    'AGENT_MORGAN',
    'AGENT_SAM',
    'AGENT_CHRIS',
    'AGENT_PAT',
    'AGENT_RILEY',
    'AGENT_CASEY',
    'AGENT_AVERY',
]

QUEUES = [
    'Tech_Support_APAC',
    'Tech_Support_US',
    'Customer_Care_Global',
    'Billing_Support_US',
    'Enterprise_Escalations',
]

NORMAL_CATEGORIES = [
    'Billing_Inquiry',
    'Account_Access',
    'Order_Tracking',
    'Subscription_Renewal',
    'General_Product_Query',
]

INCIDENT_CATEGORY = 'Mobile_App_Connection_Failure'

NORMAL_TRANSCRIPTS = {
    'Billing_Inquiry': [
        "Customer queried line-item surcharge on recent monthly statement. Agent reviewed billing schedule and credited processing variance.",
        "Caller requested invoice copy and updated credit card details on enterprise billing profile. Verified billing contacts and confirmed change.",
        "Discussion regarding prorated subscription charges following plan upgrade. Agent explained billing cycle cutoff dates clearly.",
    ],
    'Account_Access': [
        "User locked out after multi-factor authentication reset. Agent verified security answers and issued one-time password bypass token.",
        "Customer requested administrative permission transfer for organization portal. Agent processed identity verification protocol successfully.",
        "Caller needed email address change on primary customer account. Two-step verification completed and credentials refreshed.",
    ],
    'Order_Tracking': [
        "Customer inquired regarding expedited courier delivery status for hardware order. Agent tracked consignment and confirmed arrival ETA.",
        "Inquiry regarding shipment customs delay. Agent contacted logistics partner and provided updated tracking manifest.",
        "Customer confirmed receipt of initial shipment and verified serial numbers against enterprise invoice order.",
    ],
    'Subscription_Renewal': [
        "Enterprise contact reviewed upcoming annual contract renewal terms and license tiers. Agent forwarded formal quote sheet.",
        "Customer confirmed continuation of annual maintenance agreement and updated purchase order authorization number.",
        "Inquiry on multi-seat volume discount tiers for next fiscal renewal period. Agent summarized discount matrix.",
    ],
    'General_Product_Query': [
        "Caller asked regarding desktop client system requirements and supported browser versions. Agent shared knowledge base link.",
        "General inquiry on API rate limits and webhook notification configurations. Agent referenced technical developer documentation.",
        "Prospective customer requested feature comparison between Standard and Enterprise analytics tiers.",
    ],
}

INCIDENT_TRANSCRIPTS = [
    "Customer states mobile application cannot establish server connection following v2.1.0 update. Agent attempted legacy cache reset without resolution. Issue logged for engineering.",
    "Customer reports app sync failure and pairing timeout after installing v2.1.0. Agent unable to locate revised connectivity troubleshooting steps in internal KB; escalated to Tier 2.",
    "Caller experiencing connection handshake error screen upon opening mobile app v2.1.0. Agent spent 6 minutes consulting internal incident ticket before offering workaround.",
    "Customer frustrated by repeated connection drops in mobile client v2.1.0 during active workflow. Agent noted widespread app version regression and collected diagnostic logs.",
    "Urgent call regarding mobile app v2.1.0 launch crash and connection loop. Agent verified account credentials but confirmed ongoing backend service patch required.",
]


def generate_mock_dataset(filename="dashboard-ready.csv", total_calls=1200, seed=42):
    if seed is not None:
        random.seed(seed)

    start_date = datetime(2026, 8, 20, 0, 0)
    end_date = datetime(2026, 8, 26, 23, 59)
    incident_date = datetime(2026, 8, 24, 12, 0)
    total_seconds = int((end_date - start_date).total_seconds())

    rows = []

    for i in range(total_calls):
        # Evenly span across the 7-day period (150-190 calls per day)
        dt = start_date + timedelta(seconds=random.randint(0, total_seconds))
        is_incident_period = (dt >= incident_date)

        contact_id = f"CM-{random.randint(10000, 99999)}-{random.choice(['A', 'B', 'C'])}"
        agent_id = random.choice(AGENTS)
        queue_name = random.choice(QUEUES)

        is_incident_call = is_incident_period and (random.random() < 0.65)

        if is_incident_call:
            category = INCIDENT_CATEGORY
            silence_pct = round(random.uniform(32.0, 78.0), 1)
            sentiment = random.randint(-90, -15)
            agitation = random.randint(55, 95)
            compliance_risk = random.choice(['No Risk', 'Medium Risk', 'High Risk'] if agitation > 70 else ['No Risk'])
            fcr = 0 if random.random() < 0.68 else 1
            call_duration = random.randint(300, 750)
            empathy = random.randint(35, 80)
            transcript = random.choice(INCIDENT_TRANSCRIPTS)
        else:
            category = random.choice(NORMAL_CATEGORIES)
            silence_pct = round(random.uniform(4.0, 24.0), 1)
            sentiment = random.randint(10, 95)
            agitation = random.randint(10, 45)
            compliance_risk = 'No Risk' if random.random() < 0.95 else 'Medium Risk'
            fcr = 1 if random.random() < 0.82 else 0
            call_duration = random.randint(120, 420)
            empathy = random.randint(65, 98)
            transcript = random.choice(NORMAL_TRANSCRIPTS[category])

        silence_duration = int(round(call_duration * (silence_pct / 100.0)))
        
        # Calculate Agent Quality score based on realistic contact center benchmarks (~88 avg)
        base_qa = 93.0 - (silence_pct * 0.22) + (empathy * 0.08)
        if compliance_risk == 'High Risk':
            base_qa -= 8
        elif compliance_risk == 'Medium Risk':
            base_qa -= 4
        agent_qa = int(max(40, min(100, round(base_qa + random.uniform(-4, 4)))))

        rows.append({
            'Timestamp': dt.strftime('%Y-%m-%d %H:%M:%S'),
            'Contact_ID': contact_id,
            'Agent_ID': agent_id,
            'Queue_Name': queue_name,
            'Call_Duration (s)': call_duration,
            'Silence_Duration (s)': silence_duration,
            'Silence_Pct': silence_pct,
            'Max_Agitation_Score': agitation,
            'Primary_Category': category,
            'Customer_Sentiment': sentiment,
            'Agent_Quality': agent_qa,
            'Compliance_Risk': compliance_risk,
            'Empathy_Score': empathy,
            'FCR_Flag': fcr,
            'Call_Summary_Transcript': transcript,
        })

    # Sort deterministically by timestamp
    rows.sort(key=lambda r: r['Timestamp'])

    with open(filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=REQUIRED_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    return len(rows)


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic sanitized speech analytics dataset")
    parser.add_argument('--count', type=int, default=1200, help="Total number of calls to generate (default: 1200)")
    parser.add_argument('--output', type=str, default="dashboard-ready.csv", help="Output CSV path (default: dashboard-ready.csv)")
    parser.add_argument('--seed', type=int, default=42, help="Random seed for deterministic generation (default: 42)")

    args = parser.parse_args()
    count = generate_mock_dataset(filename=args.output, total_calls=args.count, seed=args.seed)
    print(f"Generated {count} records in {args.output} (seed={args.seed})")


if __name__ == '__main__':
    main()
