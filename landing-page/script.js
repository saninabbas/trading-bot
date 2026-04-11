'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const buyBtn = document.getElementById('buy-now-btn');
    const modal = document.getElementById('payment-modal');
    const closeBtn = document.querySelector('.close-modal');
    const copyBtn = document.getElementById('copy-addr-btn');
    const verifyBtn = document.getElementById('verify-payment-btn');
    const statusBox = document.getElementById('verify-status');

    // MODAL LOGIC
    buyBtn.addEventListener('click', () => {
        modal.style.display = 'block';
    });

    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };

    // COPY CLIPBOARD
    copyBtn.addEventListener('click', () => {
        const addr = document.getElementById('wallet-addr').textContent;
        navigator.clipboard.writeText(addr).then(() => {
            copyBtn.textContent = 'Copied!';
            copyBtn.style.color = '#fff';
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
                copyBtn.style.color = 'var(--gold)';
            }, 2000);
        });
    });

    // VERIFY PAYMENT (Render.com Free Backend)
    verifyBtn.addEventListener('click', async () => {
        const txHash = prompt("Please enter your Transaction Hash (TXID):");
        if (!txHash) return;

        verifyBtn.disabled = true;
        verifyBtn.textContent = '🔍 Checking Blockchain...';
        
        try {
            // Your NEW Vercel URL from the dashboard
            const VERCEL_URL = 'https://trading-bot-liart.vercel.app'; 
            
            const res = await fetch(`${VERCEL_URL}/api/verify-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txHash })
            });
            const data = await res.json();

            if (data.ok) {
                statusBox.innerHTML = `
                    <div style="background:rgba(212,175,55,0.1); border:1px solid var(--gold); padding:20px; border-radius:10px; margin-top:15px">
                        <h4 style="color:var(--gold)">✅ Payment Verified!</h4>
                        <p style="font-size:14px; margin-top:10px">Your License Key:</p>
                        <code style="display:block; background:#000; padding:10px; margin:10px 0; color:var(--gold); font-size:18px">${data.key}</code>
                        <p style="font-size:12px">Copy this key and paste it into the "Activate PRO" section of your bot.</p>
                    </div>
                `;
            } else {
                alert("❌ " + data.msg);
            }
        } catch (e) {
            alert("❌ Server connection error. Try again in 1 minute.");
        } finally {
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'I Have Paid';
        }
    });

    // Smooth Scroll Adjust
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });
});
