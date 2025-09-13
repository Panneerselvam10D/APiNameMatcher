import axios from 'axios';

// Default configuration
let config = {
  api1: {
    url: 'https://screeningdevv2.ap.loclx.io/v1.2',
    keycloak: {
      url: 'https://keycloak-auth.inside10d.com',
      realm: 'ScreeningApp',
      clientId: 'screening-client',
      username: 'superuser',
      password: 'superuser'
    }
  },
  api2: {
    url: 'https://screeningdevv2.ap.loclx.io/v2',
    keycloak: {
      url: 'https://keycloak-auth.inside10d.com',
      realm: 'ScreeningApp',
      clientId: 'screening-client',
      username: 'superuser',
      password: 'superuser'
    }
  }
};

// Store active API instances
const apiInstances = {
  api1: null,
  api2: null
};

// Create axios instance factory function
const createAxiosInstance = (apiName) => {
  const apiConfig = config[apiName];
  if (!apiConfig) {
    throw new Error(`No configuration found for API: ${apiName}`);
  }

  const instance = axios.create({
    baseURL: apiConfig.url,
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json'
    },
  });

  // Add request interceptor to include auth token
  instance.interceptors.request.use(
    async (requestConfig) => {
      console.log(`[${apiName}] Request interceptor - Request config:`, {
        url: requestConfig.url,
        method: requestConfig.method,
        headers: requestConfig.headers
      });
      
      let token = localStorage.getItem(`${apiName}_authToken`);
      console.log(`[${apiName}] Current auth token in localStorage:`, token ? 'Token exists' : 'No token found');
      
      // If no token exists, get a new one
      if (!token) {
        console.log(`[${apiName}] No token found, attempting to get a new one...`);
        try {
          token = await getAccessToken(apiName);
          console.log(`[${apiName}] Successfully obtained new token`);
        } catch (error) {
          console.error(`[${apiName}] Failed to get access token:`, error);
          return Promise.reject(error);
        }
      }
      
      if (token) {
        requestConfig.headers.Authorization = `Bearer ${token}`;
        console.log(`[${apiName}] Added Authorization header to request`);
      } else {
        console.warn(`[${apiName}] No token available for request`);
      }
      
      console.log(`[${apiName}] Final request headers:`, requestConfig.headers);
      return requestConfig;
    },
    (error) => {
      console.error(`[${apiName}] Request interceptor error:`, error);
      return Promise.reject(error);
    }
  );

  // Add response interceptor to handle 401 errors and refresh token
  instance.interceptors.response.use(
    (response) => {
      console.log(`[${apiName}] Response received:`, {
        url: response.config.url,
        status: response.status,
        data: response.data ? 'Data received' : 'No data'
      });
      return response;
    },
    async (error) => {
      console.error(`[${apiName}] Response error:`, {
        url: error.config?.url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data ? 'Error data received' : 'No error data'
      });

      const originalRequest = error.config;
      
      // If the error is 401 and we haven't tried to refresh yet
      if (error.response?.status === 401 && !originalRequest._retry) {
        console.log(`[${apiName}] Received 401, attempting to refresh token...`);
        originalRequest._retry = true;
        
        try {
          console.log(`[${apiName}] Getting new access token...`);
          const newToken = await getAccessToken(apiName);
          
          if (newToken) {
            console.log(`[${apiName}] Successfully refreshed token`);
            // Update the Authorization header
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            
            console.log(`[${apiName}] Retrying original request with new token`);
            // Retry the original request with the new token
            return instance(originalRequest);
          } else {
            throw new Error('Failed to get new access token');
          }
        } catch (refreshError) {
          console.error(`[${apiName}] Failed to refresh token:`, refreshError);
          // If refresh fails, clear the token
          localStorage.removeItem(`${apiName}_authToken`);
          
          // Show error to user
          if (typeof window !== 'undefined') {
            console.error(`[${apiName}] Authentication failed. Please check your credentials.`);
          }
          
          return Promise.reject(refreshError);
        }
      }
      
      return Promise.reject(error);
    }
  );

  return instance;
};

// Function to update configuration
const updateConfig = (newConfig) => {
  // Preserve existing config and merge with new config
  config = {
    ...config,
    ...newConfig,
    // Deep merge for api1 and api2 configurations
    api1: {
      ...config.api1,
      ...(newConfig.api1 || {}),
      keycloak: {
        ...(config.api1?.keycloak || {}),
        ...(newConfig.api1?.keycloak || {})
      }
    },
    api2: {
      ...config.api2,
      ...(newConfig.api2 || {}),
      keycloak: {
        ...(config.api2?.keycloak || {}),
        ...(newConfig.api2?.keycloak || {})
      }
    }
  };
  
  // Recreate axios instances with new configurations
  apiInstances.api1 = createAxiosInstance('api1');
  apiInstances.api2 = createAxiosInstance('api2');
  
  console.log('Configuration updated:', {
    api1: { url: config.api1.url, keycloak: { url: config.api1.keycloak.url, realm: config.api1.keycloak.realm } },
    api2: { url: config.api2.url, keycloak: { url: config.api2.keycloak.url, realm: config.api2.keycloak.realm } }
  });
};

// Initialize API instances
updateConfig(config);

// Function to get access token from Keycloak for a specific API
const getAccessToken = async (apiName) => {
  try {
    const apiConfig = config[apiName];
    if (!apiConfig) {
      throw new Error(`No configuration found for API: ${apiName}`);
    }
    
    const { keycloak } = apiConfig;
    const params = new URLSearchParams();
    
    console.log(`[${apiName}] Keycloak Config:`, {
      url: keycloak.url,
      realm: keycloak.realm,
      clientId: keycloak.clientId,
      username: keycloak.username,
      // Don't log password for security
    });
    
    params.append('client_id', keycloak.clientId);
    params.append('username', keycloak.username);
    params.append('password', keycloak.password);
    params.append('grant_type', 'password');

    console.log(`[${apiName}] Sending token request to Keycloak...`);
    const tokenUrl = `${keycloak.url}/realms/${keycloak.realm}/protocol/openid-connect/token`;
    console.log(`[${apiName}] Token URL:`, tokenUrl);

    const response = await axios.post(
      tokenUrl,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        validateStatus: () => true // Don't throw on HTTP error status
      }
    );

    console.log(`[${apiName}] Keycloak response:`, {
      status: response.status,
      statusText: response.statusText,
      data: response.data ? 'Token received' : 'No data in response'
    });

    if (response.status === 200 && response.data?.access_token) {
      localStorage.setItem(`${apiName}_authToken`, response.data.access_token);
      return response.data.access_token;
    }
    
    // Handle error responses
    const error = new Error(response.data?.error_description || 'Authentication failed');
    error.response = response;
    throw error;
    
  } catch (error) {
    const errorInfo = {
      name: error.name,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    };
    
    console.error(`[${apiName}] Keycloak Authentication Error:`, errorInfo);
    
    // Create a new error with more details
    const authError = new Error(`Keycloak authentication failed: ${error.message}`);
    authError.details = errorInfo;
    authError.response = error.response;
    
    // Add more detailed error information
    if (error.response) {
      if (error.response.status === 401) {
        authError.message = 'Invalid credentials or insufficient permissions';
      } else if (error.response.status === 403) {
        authError.message = 'Access denied. Please check your permissions.';
      } else if (error.response.status >= 500) {
        authError.message = 'Authentication server error. Please try again later.';
      }
    } else if (error.request) {
      authError.message = 'Could not connect to the authentication server. Please check your network connection.';
    } else if (error.code === 'ECONNABORTED') {
      authError.message = 'Connection to the authentication server timed out.';
    }
    
    throw authError;
  }
};

// Utility functions for API management
const apiUtils = {
  // Get an API instance by name (api1 or api2)
  getApi: (apiName) => {
    if (!apiInstances[apiName]) {
      throw new Error(`No API instance found with name: ${apiName}`);
    }
    return apiInstances[apiName];
  },
  
  // Clear authentication token for a specific API
  clearAuthToken: (apiName) => {
    localStorage.removeItem(`${apiName}_authToken`);
    console.log(`[${apiName}] Cleared auth token`);
  },
  
  // Check if a specific API is authenticated
  isAuthenticated: (apiName) => {
    return !!localStorage.getItem(`${apiName}_authToken`);
  },
  
  // Get the current configuration
  getConfig: () => {
    return { ...config };
  },
  
  // Test connection to a specific API's Keycloak
  testKeycloakConnection: async (apiName) => {
    try {
      console.log(`[${apiName}] Testing Keycloak connection...`);
      const token = await getAccessToken(apiName);
      return {
        success: true,
        message: 'Successfully connected to Keycloak and obtained token',
        token: token ? 'Token received' : 'No token received'
      };
    } catch (error) {
      console.error(`[${apiName}] Keycloak connection test failed:`, error);
      return {
        success: false,
        message: error.message,
        details: error.details || {}
      };
    }
  }
};

const apiService = {
  ...apiUtils,
  
  /**
   * Call the univius/scanIndividual API
   * @param {string} name - The name to search for
   * @param {string} [apiName='api1'] - The API to use ('api1' or 'api2')
   * @returns {Promise<Object>} The API response
   */
  callUniviusApi: async (name, apiName = 'api1') => {
    const api = apiUtils.getApi(apiName);
    
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

  /**
   * Process a name through the specified API
   * @param {string} name - The name to process
   * @param {string} [apiName='api1'] - The API to use ('api1' or 'api2')
   * @returns {Promise<Object>} The API response
   */
  processName: async (name, apiName = 'api1') => {
    const api = apiUtils.getApi(apiName);
    const startTime = performance.now();
    
    try {
      console.log(`[${apiName}] Processing name:`, name);
      
      // Call the appropriate API endpoint based on the API name
      let response;
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

      // Determine the endpoint based on the API name
      let endpoint = '';
      if (apiName === 'api1') {
        // For API1, use the full URL as the base and no additional path
        endpoint = '';
      } else if (apiName === 'api2') {
        // For API2, use the full URL as base and no additional path
        endpoint = '';
        // Update the base URL to include the version path
        api.defaults.baseURL = config.api2.url;
      }
      
      console.log(`[${apiName}] Calling API endpoint:`, endpoint);
      
      // Add a request interceptor to measure network time
      const requestStartTime = performance.now();
      let requestEndTime;
      
      const requestInterceptor = api.interceptors.request.use(config => {
        config.metadata = { startTime: performance.now() };
        return config;
      });
      
      const responseInterceptor = api.interceptors.response.use(
        response => {
          requestEndTime = performance.now();
          // Remove interceptors after request is complete
          api.interceptors.request.eject(requestInterceptor);
          api.interceptors.response.eject(responseInterceptor);
          return response;
        },
        error => {
          requestEndTime = performance.now();
          // Remove interceptors after request fails
          api.interceptors.request.eject(requestInterceptor);
          api.interceptors.response.eject(responseInterceptor);
          return Promise.reject(error);
        }
      );
      
      // Make the API call
      response = await api.post(endpoint, payload);
      
      // Calculate the network time (time from request start to response)
      const networkTime = requestEndTime - requestStartTime;
      // Calculate the total time including any pre-request processing
      const totalTime = performance.now() - startTime;

      return {
        ...response.data,
        _duration: networkTime, // Network time (request start to response)
        _totalDuration: totalTime, // Total time including pre-request processing
        _api: apiName,
        _timestamp: new Date().toISOString(),
        _timing: {
          network: networkTime,
          total: totalTime,
          preRequest: requestStartTime - startTime
        }
      };
    } catch (error) {
      console.error(`[${apiName}] Error processing name:`, error);
      return {
        success: false,
        error: error.message,
        _api: apiName,
        _duration: performance.now() - startTime,
        _timestamp: new Date().toISOString()
      };
    }
  },
  
  /**
   * Process a file through the specified API
   * @param {File} file - The file to process
   * @param {string} [apiName='api1'] - The API to use ('api1' or 'api2')
   * @returns {Promise<Object>} The API response
   */
  processFile: async (file, apiName = 'api1') => {
    try {
      const api = apiUtils.getApi(apiName);
      console.log(`[${apiName}] Processing file:`, file.name);
      
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await api.post('/api/processFile', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      console.log(`[${apiName}] File processing response:`, response);
      return response.data;
    } catch (error) {
      console.error(`[${apiName}] Error processing file:`, error);
      throw error;
    }
  },
  
  /**
   * Process a name through both APIs sequentially and return combined results
   * @param {string} name - The name to process
   * @returns {Promise<Object>} Combined results from both APIs
   */
  processNameWithBothApis: async (name) => {
    const startTime = performance.now();
    console.log('=== Starting processNameWithBothApis ===');
    console.log('Processing name:', name);
    
    // Log current API configurations
    console.log('API1 Config URL:', config.api1.url);
    console.log('API2 Config URL:', config.api2.url);
    
    // Process a single API with detailed timing
    const processApi = async (apiName) => {
      const apiStartTime = performance.now();
      console.log(`[${apiName}] Starting processName`);
      
      try {
        const token = localStorage.getItem(`${apiName}_authToken`);
        console.log(`[${apiName}] Current token exists:`, !!token);
        
        // Process the name with the current API
        const result = await apiService.processName(name, apiName);
        
        const apiEndTime = performance.now();
        const apiDuration = apiEndTime - apiStartTime;
        
        console.log(`[${apiName}] Process name completed in ${apiDuration.toFixed(2)}ms`);
        
        return {
          success: true,
          ...result,
          api: apiName,
          _timing: {
            startTime: apiStartTime,
            endTime: apiEndTime,
            duration: apiDuration
          }
        };
      } catch (error) {
        const errorTime = performance.now();
        console.error(`[${apiName}] Error in processName:`, error);
        return {
          success: false,
          error: error.message || 'Unknown error',
          api: apiName,
          stack: error.stack,
          _timing: {
            startTime: apiStartTime,
            endTime: errorTime,
            duration: errorTime - apiStartTime,
            error: true
          }
        };
      }
    };

    try {
      // Process APIs sequentially
      console.log('Starting sequential API processing...');
      
      // Process API1
      console.log('--- Starting API1 ---');
      const api1Result = await processApi('api1');
      
      // Process API2 after API1 completes
      console.log('--- Starting API2 ---');
      const api2Result = await processApi('api2');
      
      console.log('=== API Results ===');
      console.log('API1 Result:', {
        success: api1Result.success,
        status: api1Result.status,
        duration: api1Result._timing?.duration?.toFixed(2) + 'ms',
        error: api1Result.error,
        responseExists: !!api1Result.responses
      });
      console.log('API2 Result:', {
        success: api2Result.success,
        status: api2Result.status,
        duration: api2Result._timing?.duration?.toFixed(2) + 'ms',
        error: api2Result.error,
        responseExists: !!api2Result.responses
      });
      
      const totalDuration = performance.now() - startTime;
      
      const result = {
        success: api1Result.success || api2Result.success,
        api1: api1Result,
        api2: api2Result,
        timestamp: new Date().toISOString(),
        _timing: {
          startTime,
          endTime: performance.now(),
          totalDuration,
          api1Duration: api1Result._timing?.duration,
          api2Duration: api2Result._timing?.duration
        },
        _debug: {
          api1Url: config.api1.url,
          api2Url: config.api2.url,
          api1Token: !!localStorage.getItem('api1_authToken'),
          api2Token: !!localStorage.getItem('api2_authToken')
        }
      };
      
      console.log(`Total processing time: ${totalDuration.toFixed(2)}ms`);
      console.log('Final combined result:', result);
      return result;
      
    } catch (error) {
      const errorTime = performance.now();
      console.error('Unexpected error in processNameWithBothApis:', error);
      return {
        success: false,
        error: `Unexpected error: ${error.message}`,
        timestamp: new Date().toISOString(),
        stack: error.stack,
        _timing: {
          startTime,
          endTime: errorTime,
          duration: errorTime - startTime,
          error: true
        }
      };
    }
  },
  
  /**
   * Process a file through both APIs and return combined results
   * @param {File} file - The file to process
   * @returns {Promise<Object>} Combined results from both APIs
   */
  processFileWithBothApis: async (file) => {
    try {
      console.log('Processing file with both APIs:', file.name);
      
      // Process with both APIs in parallel
      const [api1Result, api2Result] = await Promise.all([
        apiService.processFile(file, 'api1').catch(error => ({
          success: false,
          error: error.message,
          api: 'api1'
        })),
        apiService.processFile(file, 'api2').catch(error => ({
          success: false,
          error: error.message,
          api: 'api2'
        }))
      ]);
      
      return {
        success: true,
        api1: api1Result,
        api2: api2Result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error processing file with both APIs:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
};

// Initialize with default config
updateConfig(config);

export default {
  ...apiService,
  updateConfig
};
