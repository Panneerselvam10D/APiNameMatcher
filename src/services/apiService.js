import axios from 'axios';

// Load environment variables
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '';

// Keycloak configuration from environment variables
const KEYCLOAK_CONFIG = {
  url: process.env.REACT_APP_KEYCLOAK_URL || '',
  realm: process.env.REACT_APP_KEYCLOAK_REALM || 'ScreeningApp',
  clientId: process.env.REACT_APP_KEYCLOAK_CLIENT_ID || 'screening-client',
  username: process.env.REACT_APP_KEYCLOAK_USERNAME || 'superuser',
  password: process.env.REACT_APP_KEYCLOAK_PASSWORD || 'superuser'
};


// API endpoints configuration
const API_BASE_PATH = '/namecheck/rule-matching/';
const API_ENDPOINTS = {
  v1_2: `${API_BASE_PATH}${process.env.REACT_APP_API_ENDPOINT_API_1 || 'v1.2'}`,
  v2: `${API_BASE_PATH}${process.env.REACT_APP_API_ENDPOINT_API_2 || 'v2'}`
};

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  // Removed timeout to allow requests to complete regardless of duration
  headers: {
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json'
  },
});

// Function to get access token from Keycloak
const getAccessToken = async () => {
  try {
    const params = new URLSearchParams();
    params.append('client_id', KEYCLOAK_CONFIG.clientId);
    params.append('username', KEYCLOAK_CONFIG.username);
    params.append('password', KEYCLOAK_CONFIG.password);
    params.append('grant_type', 'password');

    const response = await axios.post(
      `${KEYCLOAK_CONFIG.url}/realms/${KEYCLOAK_CONFIG.realm}/protocol/openid-connect/token`,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (response.data && response.data.access_token) {
      localStorage.setItem('authToken', response.data.access_token);
      return response.data.access_token;
    }
    throw new Error('No access token received');
  } catch (error) {
    console.error('Error getting access token:', error);
    throw error;
  }
};

// Add request interceptor to include auth token and handle token refresh
api.interceptors.request.use(
  async (config) => {
    let token = localStorage.getItem('authToken');
    
    // If no token exists, get a new one
    if (!token) {
      token = await getAccessToken();
    }
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle 401 errors and refresh token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // If the error is 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        // Get a new token
        const newToken = await getAccessToken();
        
        // Update the Authorization header
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        
        // Retry the original request with the new token
        return api(originalRequest);
      } catch (error) {
        // If refresh fails, clear the token and redirect to login
        localStorage.removeItem('authToken');
        return Promise.reject(error);
      }
    }
    
    return Promise.reject(error);
  }
);

const apiService = {
  // Process a single name through both APIs
  processName: async (name) => {
    const startTime = performance.now();
    let v2Response, v4Response;
    let v2Time = 0;
    let v4Time = 0;
    
    try {
      const payload = {
        matchingRequestDto: [{
          fullName: name,
          date: "",
          year: "",
          idNumber: "",
          nationality: "",
          channelName: "internal",
          contact: "",
          accountNo: "",
          customerType: "",
          type: "Person",
          transactionType: "",
          flag: false,
          limitFlag: 10000
        }]
      };

      // Call both APIs with timing
      const v2Start = performance.now();
      v2Response = await api.post(API_ENDPOINTS.v1_2, payload);
      v2Time = performance.now() - v2Start;

      const v4Start = performance.now();
      v4Response = await api.post(API_ENDPOINTS.v2, payload);
      v4Time = performance.now() - v4Start;

      return {
        v2: { ...v2Response.data, _duration: v2Time },
        v4: { ...v4Response.data, _duration: v4Time },
        name,
        _totalDuration: performance.now() - startTime
      };
    } catch (error) {
      console.error('Error processing name:', error);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Status code:', error.response.status);
      }
      throw error;
    }
  },

  // Process a file through both APIs
  processFile: async (file, authToken) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('authToken', authToken);

    try {
      const response = await api.post('/api/process-file', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${authToken}`
        },
      });
      return response.data;
    } catch (error) {
      console.error('Error processing file:', error);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Status code:', error.response.status);
      }
      throw error;
    }
  },
};

export default apiService;





