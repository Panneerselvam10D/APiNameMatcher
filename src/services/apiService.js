import axios from 'axios';

// Default configuration
let config = {
  apiBaseUrl: 'https://screeningdevv2.ap.loclx.io',
  keycloakConfig: {
    url: 'https://keycloak-auth.inside10d.com',
    realm: 'ScreeningApp',
    clientId: 'screening-client',
    username: 'superuser',
    password: 'superuser'
  },
  apiEndpoints: {
    v1_2: 'v1.2',
    v2: 'v2'
  }
};

// Create axios instance factory function
const createAxiosInstance = (baseURL) => {
  const instance = axios.create({
    baseURL,
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json'
    },
  });

  // Add request interceptor to include auth token
  instance.interceptors.request.use(
    async (config) => {
      console.log('Request interceptor - Request config:', {
        url: config.url,
        method: config.method,
        headers: config.headers
      });
      
      let token = localStorage.getItem('authToken');
      console.log('Current auth token in localStorage:', token ? 'Token exists' : 'No token found');
      
      // If no token exists, get a new one
      if (!token) {
        console.log('No token found, attempting to get a new one...');
        try {
          token = await getAccessToken();
          console.log('Successfully obtained new token');
        } catch (error) {
          console.error('Failed to get access token:', error);
          return Promise.reject(error);
        }
      }
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('Added Authorization header to request');
      } else {
        console.warn('No token available for request');
      }
      
      console.log('Final request headers:', config.headers);
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Add response interceptor to handle 401 errors and refresh token
  instance.interceptors.response.use(
    (response) => {
      console.log('Response received:', {
        url: response.config.url,
        status: response.status,
        data: response.data
      });
      return response;
    },
    async (error) => {
      console.error('Response error:', {
        url: error.config?.url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });

      const originalRequest = error.config;
      
      // If the error is 401 and we haven't tried to refresh yet
      if (error.response?.status === 401 && !originalRequest._retry) {
        console.log('Received 401, attempting to refresh token...');
        originalRequest._retry = true;
        
        try {
          console.log('Getting new access token...');
          const newToken = await getAccessToken();
          
          if (newToken) {
            console.log('Successfully refreshed token');
            // Update the Authorization header
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            
            console.log('Retrying original request with new token');
            // Retry the original request with the new token
            return instance(originalRequest);
          } else {
            throw new Error('Failed to get new access token');
          }
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError);
          // If refresh fails, clear the token
          localStorage.removeItem('authToken');
          
          // Show error to user
          if (typeof window !== 'undefined') {
            // You can show a notification to the user here if needed
            console.error('Authentication failed. Please log in again.');
          }
          
          return Promise.reject(refreshError);
        }
      }
      
      return Promise.reject(error);
    }
  );

  return instance;
};

// Create initial axios instance
let api = createAxiosInstance(config.apiBaseUrl);

// Function to update configuration
const updateConfig = (newConfig) => {
  config = {
    ...config,
    ...newConfig,
    keycloakConfig: {
      ...config.keycloakConfig,
      ...(newConfig.keycloakConfig || {})
    },
    apiEndpoints: {
      ...config.apiEndpoints,
      ...(newConfig.apiEndpoints || {})
    }
  };
  
  // Recreate axios instance with new configuration
  api = createAxiosInstance(config.apiBaseUrl);
};

// Function to get access token from Keycloak
const getAccessToken = async () => {
  try {
    const params = new URLSearchParams();
    const { keycloakConfig } = config;
    
    console.log('Keycloak Config:', {
      url: keycloakConfig.url,
      realm: keycloakConfig.realm,
      clientId: keycloakConfig.clientId,
      username: keycloakConfig.username,
      // Don't log password for security
    });
    
    params.append('client_id', keycloakConfig.clientId);
    params.append('username', keycloakConfig.username);
    params.append('password', keycloakConfig.password);
    params.append('grant_type', 'password');

    console.log('Sending token request to Keycloak...');
    const tokenUrl = `${keycloakConfig.url}/realms/${keycloakConfig.realm}/protocol/openid-connect/token`;
    console.log('Token URL:', tokenUrl);

    const response = await axios.post(
      tokenUrl,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log('Keycloak response:', {
      status: response.status,
      statusText: response.statusText,
      data: response.data ? 'Token received' : 'No data in response'
    });

    if (response.data?.access_token) {
      localStorage.setItem('authToken', response.data.access_token);
      return response.data.access_token;
    }
    throw new Error('No access token received in response');
  } catch (error) {
    console.error('Keycloak Authentication Error:', {
      name: error.name,
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : 'No response',
      config: {
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers
      }
    });
    
    let errorMessage = 'Authentication failed';
    if (error.response) {
      if (error.response.status === 401) {
        errorMessage = 'Invalid credentials or insufficient permissions';
      } else if (error.response.status === 403) {
        errorMessage = 'Access denied. Please check your permissions.';
      } else if (error.response.status >= 500) {
        errorMessage = 'Authentication server error. Please try again later.';
      }
    } else if (error.request) {
      errorMessage = 'Could not connect to the authentication server. Please check your network connection.';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Connection to the authentication server timed out.';
    }
    
    const authError = new Error(`Authentication Error: ${errorMessage}`);
    authError.originalError = error;
    throw authError;
  }
};

// Interceptors are now included in the createAxiosInstance function

const apiService = {
  // Process a single name through both APIs
  // Helper function to call the univius/scanIndividual API
  callUniviusApi: async (name) => {
    const payload = {
      authToken: "w/gsi7g8xRz9c3y1HtngDw==",
      name: name,
      dateOfBirth: "",
      country: "",
      nationalId: "",
      listName: "All",
      sourceSystem: "MIRS",
      nameMatchPercent: 70,
      overallMatchPercent: 25,
      topRecordCount: 5,
      listCategoryName: "SANCTION LIST",
      senderOrReceiver: "Sender",
      phoneNumber: "",
      accountNumber: ""
    };

    try {
      const response = await axios.post(
        'https://amluat.mtradeasia.com:2096/univius/scanIndividual',
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error calling univius API:', error);
      return { error: error.message };
    }
  },

  processName: async (name) => {
    const startTime = performance.now();
    let v2Response, v4Response, univiusResponse;
    let v2Time = 0, v4Time = 0, univiusTime = 0;
    
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

      // Get API endpoints from config
      const v1_2Endpoint = `${config.apiEndpoints.v1_2}`.startsWith('http') 
        ? config.apiEndpoints.v1_2 
        : `namecheck/rule-matching/${config.apiEndpoints.v1_2}`;
        
      const v2Endpoint = `${config.apiEndpoints.v2}`.startsWith('http')
        ? config.apiEndpoints.v2
        : `namecheck/rule-matching/${config.apiEndpoints.v2}`;

      // Call all three APIs with timing
      const v2Start = performance.now();
      v2Response = await api.post(v1_2Endpoint, payload);
      v2Time = performance.now() - v2Start;

      const v4Start = performance.now();
      v4Response = await api.post(v2Endpoint, payload);
      v4Time = performance.now() - v4Start;

      const univiusStart = performance.now();
      univiusResponse = await apiService.callUniviusApi(name);
      univiusTime = performance.now() - univiusStart;

      return {
        v2: { ...v2Response.data, _duration: v2Time },
        v4: { ...v4Response.data, _duration: v4Time },
        univius: { ...univiusResponse, _duration: univiusTime },
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
  processFile: async (file) => {
    console.log('Processing file:', file.name);
    const formData = new FormData();
    formData.append('file', file);
    
    // Get API endpoints from config
    const v1_2UploadEndpoint = `${config.apiEndpoints.v1_2}`.startsWith('http') 
      ? `${config.apiEndpoints.v1_2}/upload`
      : `/namecheck/rule-matching/${config.apiEndpoints.v1_2}/upload`;
      
    const v2UploadEndpoint = `${config.apiEndpoints.v2}`.startsWith('http')
      ? `${config.apiEndpoints.v2}/upload`
      : `/namecheck/rule-matching/${config.apiEndpoints.v2}/upload`;
    
    console.log('Uploading to endpoints:', { v1_2UploadEndpoint, v2UploadEndpoint });
    
    // Use the configured api instance which includes the auth interceptors
    const v2Response = await api.post(v1_2UploadEndpoint, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    const v4Response = await api.post(v2UploadEndpoint, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    console.log('File processing completed');
    return {
      v2: v2Response.data,
      v4: v4Response.data
    };
  },
};

// Initialize with default config
updateConfig(config);

export default {
  ...apiService,
  updateConfig
};





