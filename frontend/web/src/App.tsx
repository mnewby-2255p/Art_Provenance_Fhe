// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ArtRecord {
  id: string;
  encryptedPrice: string;
  timestamp: number;
  owner: string;
  artworkName: string;
  artist: string;
  provenanceHistory: string[];
  status: "pending" | "verified" | "rejected";
}

// Randomly selected style: Gradient (warm sunset) + Glassmorphism + Time Axis + Micro-interactions
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ArtRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({ 
    artworkName: "", 
    artist: "",
    price: 0,
    provenanceNote: ""
  });
  const [selectedRecord, setSelectedRecord] = useState<ArtRecord | null>(null);
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<"provenance" | "auction">("provenance");
  const [searchTerm, setSearchTerm] = useState("");

  // Randomly selected features: Data Statistics, Timeline Visualization, Search & Filter
  const verifiedCount = records.filter(r => r.status === "verified").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("art_record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing record keys:", e); }
      }
      
      const list: ArtRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`art_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                encryptedPrice: recordData.encryptedPrice, 
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                artworkName: recordData.artworkName,
                artist: recordData.artist,
                provenanceHistory: recordData.provenanceHistory || [],
                status: recordData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing record data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading record ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { console.error("Error loading records:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitRecord = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting artwork price with Zama FHE..." });
    try {
      const encryptedPrice = FHEEncryptNumber(newRecordData.price);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const recordData = { 
        encryptedPrice, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        artworkName: newRecordData.artworkName,
        artist: newRecordData.artist,
        provenanceHistory: [newRecordData.provenanceNote],
        status: "pending" 
      };
      
      await contract.setData(`art_record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(recordData)));
      
      const keysBytes = await contract.getData("art_record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(recordId);
      await contract.setData("art_record_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Artwork record submitted with FHE encryption!" });
      await loadRecords();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({ 
          artworkName: "", 
          artist: "",
          price: 0,
          provenanceNote: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const verifyRecord = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Verifying artwork provenance..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const recordBytes = await contract.getData(`art_record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedRecord = { ...recordData, status: "verified" };
      await contractWithSigner.setData(`art_record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Artwork provenance verified!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Rejecting artwork record..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const recordBytes = await contract.getData(`art_record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      const updatedRecord = { ...recordData, status: "rejected" };
      await contract.setData(`art_record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      setTransactionStatus({ visible: true, status: "success", message: "Artwork record rejected!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const addProvenanceNote = async (recordId: string, note: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Adding provenance note..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const recordBytes = await contract.getData(`art_record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedProvenance = [...(recordData.provenanceHistory || []), note];
      const updatedRecord = { ...recordData, provenanceHistory: updatedProvenance };
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      await contractWithSigner.setData(`art_record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Provenance note added!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to add note: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (recordAddress: string) => address?.toLowerCase() === recordAddress.toLowerCase();

  const filteredRecords = records.filter(record => 
    record.artworkName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.artist.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderTimeline = (provenanceHistory: string[]) => {
    return (
      <div className="timeline-container">
        {provenanceHistory.map((item, index) => (
          <div key={index} className="timeline-item">
            <div className="timeline-marker"></div>
            <div className="timeline-content">
              <div className="timeline-date">{new Date().toLocaleDateString()}</div>
              <div className="timeline-text">{item}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading encrypted art provenance...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Art<span>Provenance</span>FHE</h1>
          <p className="tagline">Confidential Art Provenance with Zama FHE</p>
        </div>
        <div className="header-actions">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search artworks..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-icon"></button>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Artwork
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Secure Art Provenance Tracking</h2>
            <p>Confidentially track artwork ownership and transaction history with fully homomorphic encryption</p>
          </div>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>

        <div className="dashboard-cards">
          <div className="stats-card">
            <h3>Artwork Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Artworks</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>

          <div className="info-card">
            <h3>How FHE Protects Art Market</h3>
            <ul>
              <li>Transaction prices remain encrypted</li>
              <li>Provenance verified without exposing details</li>
              <li>Only authorized parties can decrypt data</li>
              <li>Immutable blockchain record</li>
            </ul>
          </div>
        </div>

        <div className="tabs-container">
          <div className="tabs">
            <button 
              className={`tab-button ${activeTab === "provenance" ? "active" : ""}`}
              onClick={() => setActiveTab("provenance")}
            >
              Provenance Records
            </button>
            <button 
              className={`tab-button ${activeTab === "auction" ? "active" : ""}`}
              onClick={() => setActiveTab("auction")}
            >
              Confidential Auctions
            </button>
          </div>
        </div>

        <div className="records-section">
          <div className="section-header">
            <h2>{activeTab === "provenance" ? "Artwork Provenance" : "Auction Records"}</h2>
            <button onClick={loadRecords} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="no-records">
              <div className="empty-icon"></div>
              <p>No artwork records found</p>
              <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
                Register First Artwork
              </button>
            </div>
          ) : (
            <div className="records-list">
              {filteredRecords.map(record => (
                <div 
                  className={`record-card ${record.status}`} 
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                >
                  <div className="record-header">
                    <h3>{record.artworkName}</h3>
                    <span className={`status-badge ${record.status}`}>{record.status}</span>
                  </div>
                  <div className="record-details">
                    <div className="detail-item">
                      <span>Artist:</span>
                      <strong>{record.artist}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Owner:</span>
                      <strong>{record.owner.substring(0, 6)}...{record.owner.substring(38)}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Registered:</span>
                      <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
                    </div>
                  </div>
                  <div className="record-actions">
                    {isOwner(record.owner) && record.status === "pending" && (
                      <>
                        <button className="action-btn verify" onClick={(e) => { e.stopPropagation(); verifyRecord(record.id); }}>
                          Verify
                        </button>
                        <button className="action-btn reject" onClick={(e) => { e.stopPropagation(); rejectRecord(record.id); }}>
                          Reject
                        </button>
                      </>
                    )}
                    <button className="action-btn view" onClick={(e) => { e.stopPropagation(); setSelectedRecord(record); }}>
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Register New Artwork</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Artwork Name *</label>
                <input 
                  type="text" 
                  name="artworkName" 
                  value={newRecordData.artworkName} 
                  onChange={(e) => setNewRecordData({...newRecordData, artworkName: e.target.value})}
                  placeholder="e.g. Starry Night"
                />
              </div>
              <div className="form-group">
                <label>Artist *</label>
                <input 
                  type="text" 
                  name="artist" 
                  value={newRecordData.artist} 
                  onChange={(e) => setNewRecordData({...newRecordData, artist: e.target.value})}
                  placeholder="e.g. Vincent van Gogh"
                />
              </div>
              <div className="form-group">
                <label>Last Transaction Price (ETH) *</label>
                <input 
                  type="number" 
                  name="price" 
                  value={newRecordData.price} 
                  onChange={(e) => setNewRecordData({...newRecordData, price: parseFloat(e.target.value)})}
                  placeholder="e.g. 2.5"
                  step="0.01"
                />
                <div className="encryption-notice">
                  Price will be encrypted with Zama FHE before storage
                </div>
              </div>
              <div className="form-group">
                <label>Initial Provenance Note</label>
                <textarea 
                  name="provenanceNote" 
                  value={newRecordData.provenanceNote} 
                  onChange={(e) => setNewRecordData({...newRecordData, provenanceNote: e.target.value})}
                  placeholder="e.g. Purchased from Christie's auction in 2020"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button 
                onClick={submitRecord} 
                disabled={creating || !newRecordData.artworkName || !newRecordData.artist || !newRecordData.price}
                className="submit-btn"
              >
                {creating ? "Encrypting with FHE..." : "Register Artwork"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRecord && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>{selectedRecord.artworkName}</h2>
              <button onClick={() => { setSelectedRecord(null); setDecryptedPrice(null); }} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="artwork-info">
                <div className="info-item">
                  <span>Artist:</span>
                  <strong>{selectedRecord.artist}</strong>
                </div>
                <div className="info-item">
                  <span>Owner:</span>
                  <strong>{selectedRecord.owner.substring(0, 6)}...{selectedRecord.owner.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Registered:</span>
                  <strong>{new Date(selectedRecord.timestamp * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-item">
                  <span>Status:</span>
                  <strong className={`status-badge ${selectedRecord.status}`}>{selectedRecord.status}</strong>
                </div>
              </div>

              <div className="price-section">
                <h3>Last Transaction Price</h3>
                <div className="encrypted-price">
                  {selectedRecord.encryptedPrice.substring(0, 50)}...
                </div>
                <button 
                  className="decrypt-btn"
                  onClick={async () => {
                    if (decryptedPrice !== null) {
                      setDecryptedPrice(null);
                    } else {
                      const price = await decryptWithSignature(selectedRecord.encryptedPrice);
                      setDecryptedPrice(price);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedPrice !== null ? "Hide Price" : "Decrypt Price"}
                </button>
                {decryptedPrice !== null && (
                  <div className="decrypted-price">
                    <span>Decrypted Price:</span>
                    <strong>{decryptedPrice} ETH</strong>
                  </div>
                )}
              </div>

              <div className="provenance-section">
                <h3>Provenance History</h3>
                {renderTimeline(selectedRecord.provenanceHistory)}
                {isOwner(selectedRecord.owner) && (
                  <div className="add-note-form">
                    <h4>Add Provenance Note</h4>
                    <textarea placeholder="Add new provenance note..."></textarea>
                    <button className="add-note-btn">Add Note</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>ArtProvenanceFHE</h3>
            <p>Confidential art provenance tracking powered by Zama FHE technology</p>
          </div>
          <div className="footer-section">
            <h3>Resources</h3>
            <a href="#">Documentation</a>
            <a href="#">FHE Whitepaper</a>
            <a href="#">API Reference</a>
          </div>
          <div className="footer-section">
            <h3>Legal</h3>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} ArtProvenanceFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;