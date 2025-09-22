// app.js
// Shared frontend logic for FaceSwipe
// Assumes firebase-config.js has defined `auth`, `db`, `storage`

/* ---------- Helpers ---------- */
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showError = (el, msg) => {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
};
const hideError = (el) => { if (el) el.classList.add('hidden'); };
const now = () => new Date().toISOString();

// Basic guard to ensure Firebase objects exist
if (typeof auth === 'undefined' || typeof db === 'undefined' || typeof storage === 'undefined') {
  console.warn("Firebase not initialized yet. Ensure firebase-config.js is loaded before app.js.");
}

/* ---------- Index (Login / Signup) ---------- */
(function initIndexPage() {
  const loginForm = qs('#loginForm');
  const signupForm = qs('#signupForm');
  const resetForm = qs('#resetForm');
  const toggleToSignup = qs('#toggleToSignup');
  const backToLogin = qs('#backToLogin');
  const toReset = qs('#toReset');
  const cancelReset = qs('#cancelReset');
  const formTitle = qs('#formTitle');
  const errorBox = qs('#errorBox');

  if (!loginForm) return; // not on index page

  // UI toggles
  toggleToSignup?.addEventListener('click', () => {
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    formTitle.textContent = 'Create account';
    hideError(errorBox);
  });
  backToLogin?.addEventListener('click', () => {
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    formTitle.textContent = 'Login';
    hideError(errorBox);
  });
  toReset?.addEventListener('click', () => {
    loginForm.classList.add('hidden');
    resetForm.classList.remove('hidden');
    formTitle.textContent = 'Reset password';
    hideError(errorBox);
  });
  cancelReset?.addEventListener('click', () => {
    resetForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    formTitle.textContent = 'Login';
    hideError(errorBox);
  });

  // LOGIN
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(errorBox);
    const email = qs('#loginEmail').value.trim();
    const password = qs('#loginPassword').value;
    try {
      await auth.signInWithEmailAndPassword(email, password);
      // success -> go to feed
      window.location.href = 'feed.html';
    } catch (err) {
      showError(errorBox, err.message || 'Login failed');
    }
  });

  // SIGNUP
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(errorBox);
    const username = qs('#signupUsername').value.trim();
    const gender = qs('#signupGender').value;
    const email = qs('#signupEmail').value.trim();
    const password = qs('#signupPassword').value;
    if (!username || !gender || !email) {
      return showError(errorBox, 'Please fill all fields');
    }
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;

      // Write initial user doc
      await db.collection('users').doc(uid).set({
        username,
        gender,
        email,
        description: '',
        photoURL: '',      // set later when they upload
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Navigate to profile editor
      window.location.href = 'profile.html';
    } catch (err) {
      showError(errorBox, err.message || 'Signup failed');
    }
  });

  // RESET
  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError(errorBox);
    const email = qs('#resetEmail').value.trim();
    try {
      await auth.sendPasswordResetEmail(email);
      showError(errorBox, 'Reset email sent. Check your inbox.');
    } catch (err) {
      showError(errorBox, err.message || 'Reset failed');
    }
  });
})();

/* ---------- Global auth state + helpers for profile/feed pages ---------- */
auth.onAuthStateChanged(async (user) => {
  // if on index page, redirect to feed if logged in (handled in index HTML)
  if (!user) {
    // If on profile/feed pages and logged out -> send to index
    const onProfile = location.pathname.endsWith('profile.html');
    const onFeed = location.pathname.endsWith('feed.html');
    if (onProfile || onFeed) {
      window.location.href = 'index.html';
    }
    return;
  }

  // load profile data into profile page
  const onProfile = location.pathname.endsWith('profile.html');
  const onFeed = location.pathname.endsWith('feed.html');

  if (onProfile) await loadProfileFor(user);
  if (onFeed) await loadFeedFor(user);

  // Always attach realtime notification listener for likes on this user
  attachNotifListener(user.uid);
});

/* ---------- PROFILE PAGE LOGIC ---------- */
async function loadProfileFor(user) {
  try {
    const docRef = db.collection('users').doc(user.uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      console.warn('User doc missing - creating a placeholder.');
      await docRef.set({
        username: user.email.split('@')[0],
        gender: 'other',
        description: '',
        photoURL: ''
      });
    }
    const data = (await docRef.get()).data();

    // Fill UI
    qs('#profileUsername').value = data.username || '';
    qs('#profileGender').value = data.gender || 'other';
    qs('#profileBio').value = data.description || '';
    qs('#avatarPreview').src = data.photoURL || 'assets/default-avatar.png';
    qs('#profileStatus').textContent = '';

    // recent likes list (last 5)
    const recentLikesList = qs('#recentLikesList');
    recentLikesList.innerHTML = '';
    const likesSnapshot = await db.collection('likes')
      .where('likedId', '==', user.uid)
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();

    likesSnapshot.forEach(l => {
      const d = l.data();
      const li = document.createElement('li');
      li.textContent = `${d.likedByName || 'Someone'} liked you • ${d.tsFormatted || ''}`;
      recentLikesList.appendChild(li);
    });

  } catch (err) {
    qs('#profileStatus').textContent = 'Could not load profile: ' + (err.message || err);
  }

  // Avatar input
  qs('#chooseAvatarBtn').addEventListener('click', () => qs('#avatarInput').click());
  qs('#removeAvatarBtn').addEventListener('click', async () => {
    try {
      await db.collection('users').doc(user.uid).update({ photoURL: '' });
      qs('#avatarPreview').src = 'assets/default-avatar.png';
      qs('#profileStatus').textContent = 'Avatar removed';
    } catch (err) { qs('#profileStatus').textContent = err.message || 'Remove failed'; }
  });

  qs('#avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return qs('#profileStatus').textContent = 'Please select an image file.';
    qs('#profileStatus').textContent = 'Uploading image...';

    try {
      const storageRef = storage.ref().child(`profilePics/${user.uid}/${file.name}`);
      const snap = await storageRef.put(file);
      const url = await snap.ref.getDownloadURL();
      await db.collection('users').doc(user.uid).update({ photoURL: url });
      qs('#avatarPreview').src = url;
      qs('#profileStatus').textContent = 'Profile photo updated.';
    } catch (err) {
      qs('#profileStatus').textContent = err.message || 'Upload failed';
    }
  });

  // Save profile
  qs('#saveProfileBtn').addEventListener('click', async () => {
    const username = qs('#profileUsername').value.trim();
    const gender = qs('#profileGender').value;
    const description = qs('#profileBio').value.trim();
    if (!username) return qs('#profileStatus').textContent = 'Username required.';

    try {
      await db.collection('users').doc(user.uid).update({
        username, gender, description, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      qs('#profileStatus').textContent = 'Profile saved';
    } catch (err) {
      qs('#profileStatus').textContent = err.message || 'Save failed';
    }
  });

  // Navigation
  qs('#goFeedBtn').addEventListener('click', () => window.location.href = 'feed.html');
  qs('#logoutBtn').addEventListener('click', async () => { await auth.signOut(); window.location.href = 'index.html'; });
}

/* ---------- FEED PAGE LOGIC (swipe & like) ---------- */
let feedCards = [];   // local array of profiles to show
let currentIndex = 0; // index into feedCards
let currentUserData = null;

async function loadFeedFor(user) {
  try {
    const meSnap = await db.collection('users').doc(user.uid).get();
    currentUserData = meSnap.exists ? meSnap.data() : null;
    const myGender = currentUserData?.gender || 'other';

    // Query for opposite gender (simple logic: filter != myGender)
    const usersRef = db.collection('users').where('uid', '!=', ''); // placeholder
    // Firestore doesn't allow != in simple manner; use client-side filter:
    const allUsersSnap = await db.collection('users').get();
    feedCards = [];
    allUsersSnap.forEach(doc => {
      const d = doc.data();
      if (doc.id === user.uid) return; // skip self
      // show opposite gender — treat "other" as shown to everybody
      const show = (myGender === 'other') ? true : (d.gender !== myGender);
      if (show && d.photoURL) {
        feedCards.push({ id: doc.id, ...d });
      }
    });

    // Shuffle feed for randomness (Fisher-Yates)
    for (let i = feedCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [feedCards[i], feedCards[j]] = [feedCards[j], feedCards[i]];
    }

    currentIndex = 0;
    renderFeed();
    qs('#logoutBtn').addEventListener('click', async () => { await auth.signOut(); window.location.href = 'index.html'; });
  } catch (err) {
    console.error('Error loading feed', err);
    alert('Could not load feed: ' + (err.message || err));
  }
}

// Render the top N cards into #feedArea (we only add a few DOM nodes for performance)
function renderFeed() {
  const feedArea = qs('#feedArea');
  feedArea.innerHTML = '';
  if (!feedCards.length) {
    qs('#emptyState').classList.remove('hidden');
    return;
  } else {
    qs('#emptyState')?.classList.add('hidden');
  }

  // show up to 3 stacked cards
  const maxStack = 3;
  for (let i = currentIndex; i < Math.min(currentIndex + maxStack, feedCards.length); i++) {
    const profile = feedCards[i];
    const offset = i - currentIndex;
    const card = document.createElement('div');
    card.className = `absolute w-[360px] md:w-[520px] bg-white rounded-2xl shadow-lg overflow-hidden transform transition-all`;
    card.style.zIndex = 100 - offset;
    card.style.top = `${offset * 6}px`;
    card.style.left = `${offset * 6}px`;
    card.style.width = 'min(92%, 520px)';

    card.innerHTML = `
      <div class="h-[420px] relative">
        <img src="${profile.photoURL}" class="w-full h-full object-cover"/>
        <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent text-white">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-lg font-semibold">${escapeHtml(profile.username || 'User')}</div>
              <div class="text-xs opacity-80">${escapeHtml(profile.description || '')}</div>
            </div>
            <div class="text-xs opacity-80">${profile.gender || ''}</div>
          </div>
        </div>
      </div>
    `;

    feedArea.appendChild(card);
  }

  // control buttons attach
  qs('#likeBtn').onclick = () => doLikeTop();
  qs('#dislikeBtn').onclick = () => skipTop();
}

// Escaping helper
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"'`]/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'" :'&#39;','`':'&#96;'})[m]);
}

// User likes top card
async function doLikeTop() {
  if (currentIndex >= feedCards.length) return;
  const target = feedCards[currentIndex];
  const me = auth.currentUser;
  if (!me) { alert('Login required'); return; }
  try {
    // Prevent duplicate likes: create a deterministic doc id `${likedId}_${likedBy}`
    const docId = `${target.id}_${me.uid}`;
    const docRef = db.collection('likes').doc(docId);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      // already liked
      showTemporaryMessage('You already liked this profile.');
    } else {
      // save like
      const likedByName = currentUserData?.username || (me.email && me.email.split('@')[0]) || 'Someone';
      await docRef.set({
        likedId: target.id,
        likedBy: me.uid,
        likedByName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      showTemporaryMessage('Liked ✅');

      // optimistic UI: move to next
      currentIndex++;
      renderFeed();
    }
  } catch (err) {
    console.error('Like error', err);
    alert('Could not like: ' + (err.message || err));
  }
}

// Skip top profile (dislike)
function skipTop() {
  if (currentIndex >= feedCards.length) return showTemporaryMessage('No more profiles');
  currentIndex++;
  renderFeed();
}

/* ---------- Notifications ---------- */
let notifUnsub = null;
function attachNotifListener(uid) {
  // detach if existing
  if (notifUnsub) notifUnsub();

  // Listen for likes where likedId == uid
  notifUnsub = db.collection('likes')
    .where('likedId', '==', uid)
    .orderBy('timestamp', 'desc')
    .limit(10)
    .onSnapshot(snapshot => {
      const notifBadge = qs('#notifBadge');
      if (!notifBadge) return; // notification UI not present
      if (snapshot.empty) {
        notifBadge.classList.add('hidden');
        return;
      }
      // Count unseen (we'll compute simple count)
      const count = snapshot.size;
      notifBadge.textContent = count;
      notifBadge.classList.remove('hidden');

      // Also update recent likes list on profile page if present
      const recentList = qs('#recentLikesList');
      if (recentList) {
        recentList.innerHTML = '';
        snapshot.forEach(doc => {
          const d = doc.data();
          const ts = d.timestamp ? (new Date(d.timestamp.toDate()).toLocaleString()) : '';
          const li = document.createElement('li');
          li.textContent = `${d.likedByName || 'Someone'} liked you • ${ts}`;
          recentList.appendChild(li);
        });
      }
    }, err => console.error('Notif listener error', err));
}

/* ---------- Utility: small toast ---------- */
let toastTimer = null;
function showTemporaryMessage(msg, timeout = 1800) {
  // create or reuse toast element
  let t = qs('#fs_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'fs_toast';
    t.className = 'fixed bottom-8 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; }, timeout);
}

/* ---------- Small utilities to help hosting: local asset fallback ---------- */
/*
  Note: Add an /assets folder with:
    - default-avatar.png (placeholder)
  This file references `assets/default-avatar.png` — if you want your project size >1MB,
  drop a few images (e.g., 300KB each) into /assets and reference them across pages.
*/

/* ---------- End of app.js ---------- */
