// Sync queue management for offline operations
const SyncManager = {
  db: null,

  async init(db) {
    this.db = db;
  },

  async add(operation) {
    if (!this.db) throw new Error('DB not initialized');
    
    await this.db.syncQueue.add({
      action: operation.endpoint,
      endpoint: operation.endpoint,
      method: operation.method,
      data: operation.data,
      timestamp: Date.now(),
      synced: false
    });

    // Try to sync if online
    if (navigator.onLine) {
      this.sync();
    }
  },

  async sync() {
    if (!navigator.onLine) return;

    const operations = await this.db.syncQueue.toArray();
    if (operations.length === 0) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ operations })
      });

      if (response.ok) {
        await this.db.syncQueue.clear();
        console.log('Sync completed successfully');
      }
    } catch (err) {
      console.error('Sync failed:', err);
    }
  },

  async getPendingCount() {
    if (!this.db) return 0;
    return await this.db.syncQueue.count();
  }
};

// Auto-sync on online event
window.addEventListener('online', () => {
  SyncManager.sync();
});

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncManager;
}
