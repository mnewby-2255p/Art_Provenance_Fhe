pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ArtProvenanceFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public isBatchClosed;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    struct Artwork {
        euint32 encryptedId;
        euint32 encryptedCurrentOwnerId;
        euint32 encryptedCurrentPrice;
        euint32 encryptedLastTransferTimestamp;
        euint32 encryptedTotalTransferCount;
    }
    mapping(uint256 => Artwork) public artworks; // Keyed by batchId

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error InvalidBatch();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ArtworkSubmitted(address indexed provider, uint256 indexed batchId, bytes32 encryptedArtworkId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 currentOwnerId, uint256 currentPrice, uint256 lastTransferTimestamp, uint256 totalTransferCount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        _initIfNeeded();
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized()) {
            FHE.initialize();
        }
    }

    function _requireInitialized() internal view {
        if (!FHE.isInitialized()) {
            revert NotInitialized();
        }
    }

    function transferOwnership(address newOwner_) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner_;
        emit OwnershipTransferred(oldOwner, newOwner_);
    }

    function addProvider(address provider_) external onlyOwner {
        isProvider[provider_] = true;
        emit ProviderAdded(provider_);
    }

    function removeProvider(address provider_) external onlyOwner {
        delete isProvider[provider_];
        emit ProviderRemoved(provider_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        if (paused) {
            emit Paused(msg.sender);
        } else {
            emit Unpaused(msg.sender);
        }
    }

    function setCooldownSeconds(uint256 cooldownSeconds_) external onlyOwner {
        emit CooldownSet(cooldownSeconds, cooldownSeconds_);
        cooldownSeconds = cooldownSeconds_;
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        isBatchClosed[currentBatchId] = false;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!isBatchClosed[currentBatchId]) {
            isBatchClosed[currentBatchId] = true;
            emit BatchClosed(currentBatchId);
        }
    }

    function submitArtwork(
        euint32 encryptedArtworkId_,
        euint32 encryptedCurrentOwnerId_,
        euint32 encryptedCurrentPrice_,
        euint32 encryptedLastTransferTimestamp_,
        euint32 encryptedTotalTransferCount_
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (isBatchClosed[currentBatchId]) revert BatchClosed();
        if (currentBatchId == 0) revert InvalidBatch();

        lastSubmissionTime[msg.sender] = block.timestamp;

        Artwork storage a = artworks[currentBatchId];
        a.encryptedId = encryptedArtworkId_;
        a.encryptedCurrentOwnerId = encryptedCurrentOwnerId_;
        a.encryptedCurrentPrice = encryptedCurrentPrice_;
        a.encryptedLastTransferTimestamp = encryptedLastTransferTimestamp_;
        a.encryptedTotalTransferCount = encryptedTotalTransferCount_;

        emit ArtworkSubmitted(msg.sender, currentBatchId, FHE.toBytes32(encryptedArtworkId_));
    }

    function requestArtworkDecryption(uint256 batchId_) external whenNotPaused checkDecryptionCooldown {
        if (batchId_ == 0 || batchId_ > currentBatchId) revert InvalidBatch();
        if (!isBatchClosed[batchId_]) revert BatchClosed();

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        Artwork storage a = artworks[batchId_];
        euint32[] memory ctsArray = new euint32[](4);
        ctsArray[0] = a.encryptedCurrentOwnerId;
        ctsArray[1] = a.encryptedCurrentPrice;
        ctsArray[2] = a.encryptedLastTransferTimestamp;
        ctsArray[3] = a.encryptedTotalTransferCount;

        bytes32 stateHash = _hashCiphertexts(ctsArray);
        uint256 requestId = FHE.requestDecryption(ctsArray, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId_, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId_);
    }

    function myCallback(uint256 requestId_, bytes memory cleartexts_, bytes memory proof_) public {
        if (decryptionContexts[requestId_].processed) {
            revert ReplayAttempt();
        }

        // Security: Rebuild ciphertexts from current storage to ensure state consistency
        Artwork storage a = artworks[decryptionContexts[requestId_].batchId];
        euint32[] memory currentCts = new euint32[](4);
        currentCts[0] = a.encryptedCurrentOwnerId;
        currentCts[1] = a.encryptedCurrentPrice;
        currentCts[2] = a.encryptedLastTransferTimestamp;
        currentCts[3] = a.encryptedTotalTransferCount;

        bytes32 currentHash = _hashCiphertexts(currentCts);
        if (currentHash != decryptionContexts[requestId_].stateHash) {
            revert StateMismatch();
        }

        // Security: Verify the proof of correct decryption
        if (!FHE.checkSignatures(requestId_, cleartexts_, proof_)) {
            revert InvalidProof();
        }

        uint256 currentOwnerId = abi.decode(cleartexts_, (uint256));
        uint256 currentPrice;
        uint256 lastTransferTimestamp;
        uint256 totalTransferCount;
        assembly {
            currentPrice := mload(add(cleartexts_, 0x20))
            lastTransferTimestamp := mload(add(cleartexts_, 0x40))
            totalTransferCount := mload(add(cleartexts_, 0x60))
        }

        decryptionContexts[requestId_].processed = true;
        emit DecryptionCompleted(requestId_, decryptionContexts[requestId_].batchId, currentOwnerId, currentPrice, lastTransferTimestamp, totalTransferCount);
    }

    function _hashCiphertexts(euint32[] memory cts_) internal pure returns (bytes32) {
        bytes32[4] memory b;
        for (uint i = 0; i < cts_.length; i++) {
            b[i] = FHE.toBytes32(cts_[i]);
        }
        return keccak256(abi.encode(b, address(this)));
    }
}