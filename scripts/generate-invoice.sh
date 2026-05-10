#!/bin/bash
CLIENT_ID=$1
AMOUNT=$2
MONTH=$3
YEAR=$4

if [ -z "$CLIENT_ID" ]; then
  echo "Usage: bash generate-invoice.sh [client-id] [amount] [month] [year]"
  exit 1
fi

FILE="facture-${CLIENT_ID}-${MONTH}-${YEAR}.txt"

cat <<EOF > $FILE
==========================================================
                  FACTURE - CHATPME
==========================================================
Date: $(date +%Y-%m-%d)
Facture N°: INV-$(date +%s)

CLIENT :
ID: $CLIENT_ID
Prestation: Abonnement Chatbot IA Premium

DETAIL :
Mois de facturation: $MONTH $YEAR
Montant HT: $AMOUNT €
TVA (20%): $(echo "$AMOUNT * 0.2" | bc) €
TOTAL TTC: $(echo "$AMOUNT * 1.2" | bc) €

PAIEMENT :
Virement bancaire sous 30 jours.
IBAN: FR76 1234 5678 9012 3456 7890 123

C'est un plaisir de vous accompagner dans votre croissance !
==========================================================
EOF

echo "Facture générée avec succès : $FILE"
